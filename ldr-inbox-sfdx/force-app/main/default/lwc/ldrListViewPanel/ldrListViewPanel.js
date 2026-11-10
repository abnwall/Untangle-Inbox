import { LightningElement, api, wire } from 'lwc';
import { NavigationMixin } from 'lightning/navigation';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import { getListInfoByName, getListRecordsByName } from 'lightning/uiListsApi';
import { getObjectInfo, getPicklistValuesByRecordType } from 'lightning/uiObjectInfoApi';
import { updateRecord, notifyRecordUpdateAvailable } from 'lightning/uiRecordApi';
import { refreshApex } from '@salesforce/apex';
import getReportRows from '@salesforce/apex/LdrInboxController.getReportRows';

const OBJECT = 'Lead';
const PAGE = 50;
const PAGE_MAX = 2000;
const OPERATORS = {
    Equals: 'is',
    NotEqual: 'is not',
    LessThan: '<',
    GreaterThan: '>',
    LessOrEqual: '≤',
    GreaterOrEqual: '≥',
    Contains: 'contains',
    NotContain: 'does not contain',
    StartsWith: 'starts with',
    Includes: 'includes',
    Excludes: 'excludes',
    Within: 'within'
};
// Field types the datatable can edit safely. Picklists have no datatable editor: they stay in "Open full view".
const EDIT_TYPES = {
    String: 'text',
    TextArea: 'text',
    Email: 'email',
    Phone: 'phone',
    Url: 'url',
    Date: 'date-local',
    Double: 'number',
    Int: 'number',
    Currency: 'currency',
    // Salesforce percent values are whole numbers (50 = 50%); the datatable 'percent' type expects 0.5, so it showed 5,000%.
    Percent: 'number',
    Boolean: 'boolean'
};

/** Value of a list view column on a uiListsApi record ("Owner.Name" walks the relationship). */
function cellOf(record, path) {
    const parts = path.split('.');
    let fields = record.fields;
    for (let i = 0; i < parts.length; i++) {
        const f = fields ? fields[parts[i]] : null;
        if (!f) return { value: null, display: '' };
        if (i === parts.length - 1) {
            const display = f.displayValue !== null && f.displayValue !== undefined ? f.displayValue : f.value;
            return { value: f.value, display: display === null || display === undefined ? '' : String(display) };
        }
        fields = f.value && f.value.fields;
    }
    return { value: null, display: '' };
}

/**
 * One Lead Views panel (canvas #110 / #112 / #113).
 * - List view: lightning/uiListsApi (getListInfoByName for columns, filters and default sort; getListRecordsByName for
 *   rows) in a lightning-datatable: sortable columns (server sort), search on the loaded rows, row checkboxes, inline
 *   edit of fields the user can update (with several rows selected the datatable offers "Update N selected items"),
 *   Save -> updateRecord per row (LDS: FLS, validation rules and triggers apply), per-row errors, View / Edit row actions.
 * - Report: Apex getReportRows (Reports API) into a read-only table.
 * Both: "Open full view" opens the real list view / report as a console tab (NavigationMixin).
 */
export default class LdrListViewPanel extends NavigationMixin(LightningElement) {
    @api kind; // 'listview' | 'report'
    @api title;
    @api listViewApiName;
    @api reportId;

    listInfo;
    listError;
    fieldList; // ['Lead.Name', ...], set once the list info is in
    sortBy; // ['Lead.Name'] or ['-Lead.Name']
    pageSize = PAGE;
    records = [];
    nextPageToken;
    recordsError;
    loadingRecords = true;
    search = '';
    draftValues = [];
    errors;
    selectedCount = 0;
    savedMsg = '';
    saving = false;
    _recordsWire;
    report;
    reportError;
    reportLoading = false;
    objectFields = {};
    // Change Status (canvas 41be, #115B): selected rows, the bar, Lead Status / Lead Funnel Outcome picklists
    selectedIds = [];
    statusOpen = false;
    newStatus = '';
    newOutcome = '';
    recordTypeId;
    statusPicklist;
    outcomePicklist;

    get isListView() {
        return this.kind === 'listview';
    }

    get isReport() {
        return this.kind === 'report';
    }

    get kindLabel() {
        return this.isReport ? 'Report' : 'List view';
    }

    get panelCls() {
        return 'lvp ' + (this.isReport ? 'lvp-report' : 'lvp-list');
    }

    get tagCls() {
        return 'lvp-kind ' + (this.isReport ? 'lvp-kind-report' : 'lvp-kind-list');
    }

    objectForInfo; // 'Lead' on list view panels only, so report panels don't wire the object info

    connectedCallback() {
        if (this.isReport) this.loadReport();
        else this.objectForInfo = OBJECT;
    }

    // ------------------------------------------------------------ list view

    /** Only fires for list view panels (listViewApiName is undefined on report panels). */
    @wire(getListInfoByName, { objectApiName: OBJECT, listViewApiName: '$listViewApiName' })
    wiredInfo({ data, error }) {
        if (data) {
            this.listInfo = data;
            this.listError = undefined;
            this.fieldList = (data.displayColumns || []).map((c) => OBJECT + '.' + c.fieldApiName);
            if (!this.sortBy) {
                const o = (data.orderedByInfo || [])[0];
                this.sortBy = o ? [(o.isAscending ? '' : '-') + OBJECT + '.' + o.fieldApiName] : [OBJECT + '.Name'];
            }
        } else if (error) {
            this.listError = this.errorText(error);
            this.loadingRecords = false;
        }
    }

    @wire(getObjectInfo, { objectApiName: '$objectForInfo' })
    wiredObject({ data }) {
        if (data) {
            this.objectFields = data.fields || {};
            this.recordTypeId = data.defaultRecordTypeId;
        }
    }

    @wire(getPicklistValuesByRecordType, { objectApiName: OBJECT, recordTypeId: '$recordTypeId' })
    wiredPicklists({ data }) {
        if (data && data.picklistFieldValues) {
            this.statusPicklist = data.picklistFieldValues.Status;
            this.outcomePicklist = data.picklistFieldValues.Lead_Funnel_Outcome__c;
        }
    }

    @wire(getListRecordsByName, {
        objectApiName: OBJECT,
        listViewApiName: '$listViewApiName',
        fields: '$fieldList',
        sortBy: '$sortBy',
        pageSize: '$pageSize'
    })
    wiredRecords(result) {
        this._recordsWire = result;
        const { data, error } = result;
        if (data) {
            this.records = data.records || [];
            this.nextPageToken = data.nextPageToken;
            this.recordsError = undefined;
            this.loadingRecords = false;
        } else if (error) {
            this.recordsError = this.errorText(error);
            this.loadingRecords = false;
        }
    }

    get columnsInfo() {
        return (this.listInfo && this.listInfo.displayColumns) || [];
    }

    /** Rebuilt only when the list info or object info changes, so the datatable keeps its column widths across renders. */
    get columns() {
        const cache = this._columnsCache;
        if (cache && cache.listInfo === this.listInfo && cache.objectFields === this.objectFields) return cache.cols;
        const cols = this.columnsInfo.map((c, i) => {
            const direct = c.fieldApiName.indexOf('.') === -1;
            const f = direct ? this.objectFields[c.fieldApiName] : null;
            const editType = f && f.updateable ? EDIT_TYPES[f.dataType] : null;
            return {
                label: c.label,
                fieldName: 'c' + i,
                type: editType || 'text',
                editable: !!editType,
                sortable: !!c.sortable,
                wrapText: false,
                initialWidth: 150,
                typeAttributes: editType === 'date-local' ? { month: 'numeric', day: 'numeric', year: 'numeric' } : undefined
            };
        });
        cols.push({
            type: 'action',
            typeAttributes: {
                rowActions: [
                    { label: 'View', name: 'view' },
                    { label: 'Edit', name: 'edit' }
                ]
            }
        });
        this._columnsCache = { listInfo: this.listInfo, objectFields: this.objectFields, cols };
        return cols;
    }

    get sortedBy() {
        const s = (this.sortBy || [])[0] || '';
        const field = s.replace(/^-/, '').replace(OBJECT + '.', '');
        const i = this.columnsInfo.findIndex((c) => c.fieldApiName === field);
        return i === -1 ? undefined : 'c' + i;
    }

    get sortedDirection() {
        return ((this.sortBy || [])[0] || '').startsWith('-') ? 'desc' : 'asc';
    }

    /** Rows for the datatable; editable cells hold the raw value, the rest the display value. */
    get allRows() {
        const cols = this.columns;
        return this.records.map((rec) => {
            const row = { id: rec.id };
            this.columnsInfo.forEach((c, i) => {
                const cell = cellOf(rec, c.fieldApiName);
                row['c' + i] = cols[i].editable ? cell.value : cell.display;
            });
            return row;
        });
    }

    get rows() {
        const q = this.search.trim().toLowerCase();
        const all = this.allRows;
        if (!q) return all;
        return all.filter((r) => Object.keys(r).some((k) => k !== 'id' && String(r[k] === null || r[k] === undefined ? '' : r[k]).toLowerCase().includes(q)));
    }

    get hasTable() {
        return this.isListView && !this.listError && !!this.listInfo;
    }

    get isEmpty() {
        return this.hasTable && !this.loadingRecords && !this.recordsError && this.records.length === 0;
    }

    get countText() {
        if (!this.isListView || this.loadingRecords || this.recordsError || this.listError) return '';
        const n = this.records.length;
        const more = this.nextPageToken ? 'first ' + n + ' loaded' : n + (n === 1 ? ' lead' : ' leads');
        const q = this.search.trim();
        return more + (q ? ' · ' + this.rows.length + ' match' : '') + (this.selectedCount ? ' · ' + this.selectedCount + ' selected' : '');
    }

    get canLoadMore() {
        return !!this.nextPageToken && this.pageSize < PAGE_MAX;
    }

    get filtersText() {
        const info = this.listInfo;
        if (!info) return '';
        const parts = (info.filteredByInfo || []).map((f) => {
            const col = this.columnsInfo.find((c) => c.fieldApiName === f.fieldApiName);
            const label = f.label || (col ? col.label : f.fieldApiName);
            return label + ' ' + (OPERATORS[f.operator] || f.operator) + ' ' + (f.operandLabels || []).join(', ');
        });
        return parts.join(' · ') + (info.filterLogicString ? ' · Logic: ' + info.filterLogicString : '');
    }

    get hasFilters() {
        return !!this.filtersText;
    }

    get hasEditable() {
        return this.columns.some((c) => c.editable);
    }

    get editHint() {
        return this.hasEditable ? 'Click a ✎ cell to edit; select rows to edit several at once' : '';
    }

    get hasDraft() {
        return this.draftValues.length > 0;
    }

    get showSavedMsg() {
        return !this.hasDraft && !!this.savedMsg;
    }

    handleSearch(e) {
        this.search = e.target.value || '';
    }

    handleSort(e) {
        const i = Number(String(e.detail.fieldName).slice(1));
        const c = this.columnsInfo[i];
        if (!c) return;
        this.loadingRecords = true;
        this.sortBy = [(e.detail.sortDirection === 'desc' ? '-' : '') + OBJECT + '.' + c.fieldApiName];
    }

    handleRowSelection(e) {
        const rows = e.detail.selectedRows || [];
        this.selectedIds = rows.map((r) => r.id);
        this.selectedCount = rows.length;
        if (!rows.length) this.statusOpen = false;
    }

    // ------------------------------------------------------------ Change Status (#115B)

    get statusOff() {
        return this.selectedCount === 0 || this.saving;
    }

    get statusTitle() {
        return this.selectedCount ? 'Change Status of the ' + this.selectedCount + ' selected leads' : 'Select leads first';
    }

    get showStatusBar() {
        return this.statusOpen && this.selectedCount > 0;
    }

    get statusOptions() {
        const vals = (this.statusPicklist && this.statusPicklist.values) || [];
        return [{ label: 'Choose a status…', value: '' }]
            .concat(vals.map((v) => ({ label: v.label, value: v.value })))
            .map((o) => ({ ...o, selected: o.value === this.newStatus }));
    }

    /**
     * Lead Funnel Outcome for Wrong profile / Disqualified (2026-10-21), replacing Status Reason, which depends on Status
     * and has no values mapped to either status in production. Shown with a * and "Required when Status is …" as a
     * prompt only: Save works without it. Outcome isn't dependent.
     */
    get showOutcome() {
        return this.newStatus === 'Wrong profile' || this.newStatus === 'Disqualified';
    }

    get outcomeFlagText() {
        return 'Required when Status is ' + this.newStatus + '.';
    }

    get outcomeOptions() {
        const vals = (this.outcomePicklist && this.outcomePicklist.values) || [];
        // `selected` keeps the <select> in step with newOutcome: changing Status clears it, and without it the browser
        // kept the old option shown.
        return [{ label: 'Lead Funnel Outcome *', value: '' }]
            .concat(vals.map((v) => ({ label: v.label, value: v.value })))
            .map((o) => ({ ...o, selected: o.value === this.newOutcome }));
    }

    get statusSaveOff() {
        return this.saving || !this.newStatus;
    }

    get statusCountLabel() {
        return 'Change Status of ' + this.selectedCount + ' selected';
    }

    openStatus() {
        if (!this.selectedCount) return;
        this.statusOpen = true;
        this.newStatus = '';
        this.newOutcome = '';
        this.savedMsg = '';
    }

    cancelStatus() {
        this.statusOpen = false;
    }

    handleNewStatus(e) {
        this.newStatus = e.target.value || '';
        this.newOutcome = '';
    }

    handleNewOutcome(e) {
        this.newOutcome = e.target.value || '';
    }

    /** updateRecord per selected Lead with only Id, Status (+ Lead Funnel Outcome); per-row errors; refresh; clear selection. */
    async saveStatus() {
        if (this.statusSaveOff) return;
        const ids = this.selectedIds.slice();
        const status = this.newStatus;
        const outcome = this.showOutcome ? this.newOutcome : '';
        this.saving = true;
        const results = await Promise.allSettled(
            ids.map((id) => {
                const fields = { Id: id, Status: status };
                if (outcome) fields.Lead_Funnel_Outcome__c = outcome;
                return updateRecord({ fields });
            })
        );
        const rowErrors = {};
        let ok = 0;
        results.forEach((r, i) => {
            if (r.status === 'fulfilled') ok++;
            else rowErrors[ids[i]] = { title: 'Status not changed', messages: [this.errorText(r.reason)], fieldNames: [] };
        });
        const failed = ids.length - ok;
        this.errors = failed ? { rows: rowErrors, table: { title: failed + ' lead(s) not changed', messages: ['See the rows marked in red.'] } } : undefined;
        this.savedMsg = ok ? '✓ Status set to ' + status + (outcome ? ' (' + outcome + ')' : '') + ' on ' + ok + (ok === 1 ? ' lead' : ' leads') : '';
        this.statusOpen = false;
        this.selectedIds = failed ? ids.filter((id) => rowErrors[id]) : [];
        this.selectedCount = this.selectedIds.length;
        this.saving = false;
        if (ok) await this.refreshSaved(ids.filter((id) => !rowErrors[id]));
        if (failed) {
            this.dispatchEvent(new ShowToastEvent({ title: this.title, message: failed + ' lead(s) could not be changed.', variant: 'error' }));
        }
    }

    /** After a save: tell LDS the records changed and re-read the list (best effort; it refreshes on the next load anyway). */
    async refreshSaved(recordIds) {
        try {
            await notifyRecordUpdateAvailable(recordIds.map((recordId) => ({ recordId })));
            await refreshApex(this._recordsWire);
        } catch {
            // the list refreshes on the next load
        }
    }

    handleCellChange(e) {
        // keep the datatable's own draft list (it merges per row/field)
        this.draftValues = e.target.draftValues || [];
        this.savedMsg = '';
    }

    handleCancel() {
        this.draftValues = [];
        this.errors = undefined;
    }

    loadMore() {
        this.loadingRecords = true;
        this.pageSize = Math.min(PAGE_MAX, this.pageSize + PAGE);
    }

    /** Save: updateRecord per row (LDS: FLS, validation rules and triggers apply); failures shown per row. */
    async handleSave(e) {
        const drafts = e.detail.draftValues || [];
        if (!drafts.length) return;
        this.saving = true;
        const results = await Promise.allSettled(
            drafts.map((d) => {
                const fields = { Id: d.id };
                Object.keys(d).forEach((k) => {
                    if (k === 'id') return;
                    const c = this.columnsInfo[Number(k.slice(1))];
                    if (c) fields[c.fieldApiName] = d[k];
                });
                return updateRecord({ fields });
            })
        );
        const rowErrors = {};
        let ok = 0;
        results.forEach((r, i) => {
            if (r.status === 'fulfilled') {
                ok++;
            } else {
                rowErrors[drafts[i].id] = { title: 'Not saved', messages: [this.errorText(r.reason)], fieldNames: Object.keys(drafts[i]).filter((k) => k !== 'id') };
            }
        });
        const failed = drafts.length - ok;
        this.errors = failed ? { rows: rowErrors, table: { title: failed + ' row(s) not saved', messages: ['See the rows marked in red.'] } } : undefined;
        this.draftValues = drafts.filter((d) => rowErrors[d.id]);
        this.savedMsg = ok ? '✓ Saved ' + ok + (ok === 1 ? ' row' : ' rows') : '';
        this.saving = false;
        if (ok) await this.refreshSaved(drafts.filter((d) => !rowErrors[d.id]).map((d) => d.id));
        if (failed) {
            this.dispatchEvent(new ShowToastEvent({ title: this.title, message: failed + ' row(s) could not be saved.', variant: 'error' }));
        }
    }

    handleRowAction(e) {
        const id = e.detail.row && e.detail.row.id;
        if (!id) return;
        this[NavigationMixin.Navigate]({
            type: 'standard__recordPage',
            attributes: { recordId: id, objectApiName: OBJECT, actionName: e.detail.action.name === 'edit' ? 'edit' : 'view' }
        });
    }

    // ------------------------------------------------------------ report

    async loadReport() {
        if (this.reportLoading) return; // "Run again" double-click
        this.reportLoading = true;
        this.reportError = undefined;
        try {
            this.report = await getReportRows({ reportId: this.reportId });
        } catch (e) {
            this.reportError = this.errorText(e);
        } finally {
            this.reportLoading = false;
        }
    }

    get reportColumns() {
        return ((this.report && this.report.columns) || []).map((label, i) => ({ label, fieldName: 'c' + i, type: 'text', initialWidth: 150 }));
    }

    get reportRows() {
        const q = this.search.trim().toLowerCase();
        const rows = ((this.report && this.report.rows) || []).map((cells, r) => {
            const row = { id: 'r' + r };
            cells.forEach((v, i) => {
                row['c' + i] = v;
            });
            return row;
        });
        return q ? rows.filter((r) => Object.keys(r).some((k) => k !== 'id' && String(r[k] || '').toLowerCase().includes(q))) : rows;
    }

    get hasReportTable() {
        return this.isReport && !!this.report && !this.reportError;
    }

    get reportCountText() {
        if (!this.report) return '';
        const n = this.report.rows.length;
        const q = this.search.trim();
        return n + (n === 1 ? ' row' : ' rows') + (this.report.allData ? '' : ' (first rows only)') + (q ? ' · ' + this.reportRows.length + ' match' : '');
    }

    get reportEmpty() {
        return this.hasReportTable && this.report.rows.length === 0;
    }

    get panelCount() {
        return this.isReport ? this.reportCountText : this.countText;
    }

    // ------------------------------------------------------------ shared

    openFull() {
        if (this.isReport) {
            this[NavigationMixin.Navigate]({
                type: 'standard__recordPage',
                attributes: { recordId: this.reportId, objectApiName: 'Report', actionName: 'view' }
            });
            return;
        }
        this[NavigationMixin.Navigate]({
            type: 'standard__objectPage',
            attributes: { objectApiName: OBJECT, actionName: 'list' },
            state: { filterName: this.listViewApiName }
        });
    }

    errorText(e) {
        if (!e) return 'Unknown error';
        if (e.body) {
            if (Array.isArray(e.body)) return e.body.map((x) => x.message).join(', ');
            if (e.body.message) return e.body.message;
            if (e.body.output && e.body.output.errors && e.body.output.errors.length) return e.body.output.errors.map((x) => x.message).join(', ');
        }
        return e.message || String(e);
    }
}
