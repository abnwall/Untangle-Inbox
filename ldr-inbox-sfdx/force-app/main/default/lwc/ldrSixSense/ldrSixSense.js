import { LightningElement, api, wire } from 'lwc';
import { NavigationMixin } from 'lightning/navigation';
import { IsConsoleNavigation, openTab } from 'lightning/platformWorkspaceApi';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import { getObjectInfo, getPicklistValuesByRecordType } from 'lightning/uiObjectInfoApi';
import LEAD_OBJECT from '@salesforce/schema/Lead';
import saveSixSenseStatus from '@salesforce/apex/LdrInboxController.saveSixSenseStatus';
import {
    DEFAULT_FILTERS,
    TYPE_COLOR,
    boxOf,
    boxCounts,
    boxRows,
    applyFilters,
    orderedPeople,
    buildListItems,
    filterOptions,
    emptyText,
    pickCard,
    ceInfo,
    customerTypeOf,
    senderOf,
    fmtDateTime,
    fmtDate,
    formatPhone
} from './sixSenseModel';

/**
 * 6Sense tab body (canvas #151, #152 A / K, #154 / #155 A): the list (Mine / Unassigned boxes, filters, CE Lead Status
 * groups, one card per person) on the left and the person's page on the right. ldrInbox loads getSixSenseReplies,
 * passes it as `data`, and reloads it on "sixsensechanged" (after a status save or undo).
 */
const STATUSES = ['Working', 'Nurture', 'Unreachable', 'Disqualified'];
const DISQUALIFIED = 'Disqualified';
// Owner aliases: copied from ldrInbox/repRouting.js OWNER_ALIASES (a component can't import another component's
// module files). Keep the two in step.
const OWNER_ALIASES = { 'stuart ferrell': 'Julie Barnes', 'nick wnenk': 'Gro Gabor', 'bryan bush': 'Cameron Wiese' };

function aliasOwner(name) {
    const n = (name || '').trim();
    return OWNER_ALIASES[n.toLowerCase().replace(/\s+/g, ' ')] || n;
}

/** Today in Pacific time as yyyy-mm-dd (Lead Funnel Time Stamp), like ldrInbox's todayPacific(). */
function todayPacific() {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
}

function errorText(e) {
    if (!e) return 'Unknown error';
    if (e.body && e.body.message) return e.body.message;
    if (Array.isArray(e.body) && e.body.length) return e.body.map((x) => x.message).join(', ');
    return e.message || String(e);
}

function rec(object, id) {
    return id ? '/lightning/r/' + object + '/' + id + '/view' : null;
}

export default class LdrSixSense extends NavigationMixin(LightningElement) {
    /** The inbox viewer (admins' "View as" too): Mine = Project Coordinator is this user. */
    @api viewerId;
    /** SixSenseReplyResult from LdrInboxController.getSixSenseReplies; null while loading. */
    @api data;
    @api loading = false;
    @api error;

    @wire(IsConsoleNavigation) isConsole;
    @wire(getObjectInfo, { objectApiName: LEAD_OBJECT }) leadInfo;

    @wire(getPicklistValuesByRecordType, { objectApiName: LEAD_OBJECT, recordTypeId: '$leadRecordTypeId' })
    wiredLeadPicklists({ data }) {
        const f = data && data.picklistFieldValues && data.picklistFieldValues.Lead_Funnel_Outcome__c;
        if (f) this.outcomeValues = (f.values || []).map((v) => ({ value: v.value, label: v.label }));
    }

    get leadRecordTypeId() {
        return this.leadInfo && this.leadInfo.data ? this.leadInfo.data.defaultRecordTypeId : undefined;
    }

    box = 'mine';
    filters = { ...DEFAULT_FILTERS };
    sortOrder = 'newest';
    activeKey = null;
    collapsed = {};
    /** leadId -> { prev: {status, outcome, timeStamp}, status, outcome, timeStamp } for status buttons set here (undo). */
    edits = {};
    /** leadId -> Outcome picked here without a status button. */
    outcomes = {};
    /** leadId -> the person as last listed, so the page stays open after they drop off the list (canvas #151 G). */
    pinned = {};
    outcomeValues = [];
    busy = false;
    _focus;
    _scrollTo;
    _memo = {};

    /**
     * { key: leadId, box: 'mine' | 'unassigned', nonce } from the inbox's search results: switch to that box, reset the
     * filters, select the person and scroll the card into view.
     */
    @api
    get focus() {
        return this._focus;
    }
    set focus(v) {
        this._focus = v;
        if (!v || !v.key) return;
        this.box = v.box === 'unassigned' ? 'unassigned' : 'mine';
        this.filters = { ...DEFAULT_FILTERS };
        this.activeKey = v.key;
        const c = { ...this.collapsed };
        delete c[v.key];
        this.collapsed = c;
        this._scrollTo = v.key;
    }

    renderedCallback() {
        if (!this._scrollTo) return;
        const el = this.template.querySelector('[data-card="' + this._scrollTo + '"]');
        if (el) {
            el.scrollIntoView({ block: 'nearest' });
            this._scrollTo = null;
        } else if (this.data && !this.loading) {
            this._scrollTo = null; // not in this box's list (e.g. filtered out); the page still opens
        }
    }

    /** Recomputes fn only when one of deps changed (the template reads these getters many times per render). */
    memo(name, deps, fn) {
        const m = this._memo[name];
        if (m && m.deps.length === deps.length && m.deps.every((d, i) => d === deps[i])) return m.value;
        const value = fn();
        this._memo[name] = { deps, value };
        return value;
    }

    get people() {
        return (this.data && this.data.people) || [];
    }

    get boxPeople() {
        return this.memo('box', [this.data, this.box, this.viewerId], () => boxRows(this.people, this.box, this.viewerId));
    }

    get filtered() {
        return this.memo('filtered', [this.boxPeople, this.filters], () => applyFilters(this.boxPeople, this.filters));
    }

    /** Selected person's key: the clicked / focused one if it still exists, else the first card (canvas ssActiveKey). */
    get effectiveKey() {
        const k = this.activeKey;
        if (k && (this.people.some((p) => p.leadId === k) || this.pinned[k])) return k;
        const first = orderedPeople(this.filtered, this.sortOrder)[0];
        return first ? first.leadId : null;
    }

    get counts() {
        return this.memo('counts', [this.data, this.viewerId], () => boxCounts(this.people, this.viewerId));
    }

    get boxes() {
        const c = this.counts;
        return [
            ['mine', 'Mine', c.mine, 'Project Coordinator is you'],
            ['unassigned', 'Unassigned', c.unassigned, 'No Project Coordinator, or one who isn’t Aqil, Jabir, Jahmanz, Samantha, WeiWei or Yasmin']
        ].map(([key, label, count, title]) => ({
            key,
            label,
            count,
            title,
            cls: 'ss-box' + (this.box === key ? ' ss-box-on' : '')
        }));
    }

    get options() {
        const f = this.filters;
        return this.memo('options', [this.boxPeople, f], () => {
            const o = filterOptions(this.boxPeople);
            const sel = (list, cur) => list.map((x) => ({ ...x, selected: x.value === cur }));
            return { record: sel(o.record, f.record), type: sel(o.type, f.type), ce: sel(o.ce, f.ce), status: sel(o.status, f.status) };
        });
    }

    get items() {
        const key = this.effectiveKey;
        return this.memo('items', [this.filtered, this.sortOrder, key, this.collapsed], () =>
            buildListItems(this.filtered, { order: this.sortOrder, activeKey: key, collapsed: this.collapsed })
        );
    }

    get listEmpty() {
        return !this.loading && this.items.length === 0;
    }

    get listEmptyText() {
        return emptyText(this.boxPeople.length, this.filtered.length, this.box);
    }

    get capped() {
        return !!(this.data && this.data.capped);
    }

    get cappedText() {
        return 'Showing the newest ' + ((this.data && this.data.limitRows) || '') + ' replies per activity type; older ones may be missing.';
    }

    get loadError() {
        return this.error || (this.data && this.data.error) || '';
    }

    get sortArrow() {
        return this.sortOrder === 'oldest' ? '↓' : '↑';
    }

    get sortTitle() {
        return this.sortOrder === 'oldest' ? 'Oldest on Top' : 'Newest on Top';
    }

    // ---------------------------------------------------------------- the person's page

    /** The selected person with the values saved here laid over them. */
    get active() {
        const key = this.effectiveKey;
        const listed = this.people.find((p) => p.leadId === key);
        const base = listed || (key && this.pinned[key]);
        if (!base) return null;
        const e = this.edits[key];
        const oc = this.outcomes[key];
        return {
            ...base,
            ...(e ? { status: e.status, outcome: e.outcome, timeStamp: e.timeStamp } : {}),
            ...(oc !== undefined ? { outcome: oc } : {}),
            listed: !!listed
        };
    }

    get hasActive() {
        return !!this.active;
    }

    // v5.7: alerts closed with ×, "<leadId>:<alert>" -> true (kept while the page is open)
    dismissed = {};

    alertOpen(key) {
        const a = this.active;
        return !!a && !this.dismissed[a.leadId + ':' + key];
    }

    get showOffAlert() {
        return !!this.d.offList && this.alertOpen('off');
    }

    get showNoCoordAlert() {
        return !!this.d.noCoordinator && this.alertOpen('noCoord');
    }

    get showSsAlerts() {
        return this.showOffAlert || this.showNoCoordAlert;
    }

    dismissAlert(e) {
        const a = this.active;
        if (a) this.dismissed = { ...this.dismissed, [a.leadId + ':' + e.currentTarget.dataset.key]: true };
    }

    get d() {
        const a = this.active;
        if (!a) return {};
        return this.memo('d', [this.data, a.leadId, a.status, a.outcome, a.timeStamp, a.listed, this.viewerId, this.busy, this.outcomeValues, this.edits], () =>
            this.buildPage(a)
        );
    }

    buildPage(a) {
        const replies = a.replies || [];
        const latest = replies[0] || {};
        const others = replies.slice(1);
        const ct = customerTypeOf(a.leadType);
        const tc = TYPE_COLOR[ct];
        const ce = ceInfo(a.ceStatus);
        const box = boxOf(a, this.viewerId);
        const phone = a.phone || '';
        const subj = (latest.subject || '').replace(/^(re|fw|fwd):\s*/i, '');
        const edit = this.edits[a.leadId];
        const outcome = a.outcome || '';
        const showOutcome = a.status === DISQUALIFIED;
        const values = this.outcomeValues.some((v) => v.value === outcome) || !outcome
            ? this.outcomeValues
            : this.outcomeValues.concat([{ value: outcome, label: outcome }]);
        return {
            name: a.name,
            firstName: (a.name || '').trim().split(/\s+/)[0] || '',
            email: a.email || '—',
            phone: formatPhone(phone) || '—',
            telHref: phone ? 'tel:' + phone.replace(/[^0-9+]/g, '') : null,
            mailHref: a.email ? 'mailto:' + a.email + '?subject=' + encodeURIComponent('Re: ' + subj) : null,
            customerType: ct,
            typeStyle: 'background:' + tc[0] + ';color:' + tc[1] + ';border-color:' + tc[2] + ';',
            ceLabel: ce.label,
            ceStyle: 'background:' + ce.bg + ';color:' + ce.fg + ';',
            ceSince: a.ceStatusTime ? 'since ' + fmtDateTime(a.ceStatusTime) : '',
            company: a.company || 'No company',
            location: [[a.city, a.state].filter(Boolean).join(', '), a.postalCode].filter(Boolean).join(' ') || 'No address on Lead',
            owner: aliasOwner(a.ownerName) || '—',
            coordinator: a.coordinatorName || 'No Project Coordinator',
            coordCls: a.coordinatorName ? 'ss-ink' : 'ss-red',
            noCoordinator: !a.coordinatorId,
            currentTab: a.listed && box ? '6Sense' : 'N/A',
            statusLabel: a.status || 'No Status',
            funnelTs: fmtDate(a.timeStamp),
            sender: senderOf(a.ceCampaign),
            campaign: a.ceCampaign || '—',
            campaignStatus: a.ceCampaignStatus ? a.ceCampaignStatus.charAt(0).toUpperCase() + a.ceCampaignStatus.slice(1) : '—',
            source: a.leadSource || '—',
            repliedAt: fmtDateTime(latest.createdDate || a.latestAt),
            subject: latest.subject || '(no subject)',
            reply: latest.body || '',
            emailHref: rec(latest.kind || 'Task', latest.id),
            others: others.map((o) => ({
                key: o.id,
                at: fmtDateTime(o.createdDate),
                subject: o.subject || '(no subject)',
                reply: o.body || '',
                href: rec(o.kind || 'Task', o.id)
            })),
            noOthers: others.length === 0,
            offList: !a.listed,
            offLine:
                'Lead Status ' + (a.status || '—') + ' · Lead Funnel Time Stamp ' + fmtDate(a.timeStamp) +
                '. No reply is newer than the Lead Funnel Time Stamp, so this person is off the 6Sense list until they reply again.',
            // Status buttons (canvas #151 G, on header line 1 per #155 A): Status + Lead Funnel Time Stamp = today;
            // the filled one, when set here, undoes.
            statusBtns: STATUSES.map((st) => {
                const on = a.status === st;
                return {
                    label: st,
                    cls: 'ss-status-btn' + (on ? ' ss-status-btn-on' : ''),
                    pressed: on ? 'true' : 'false',
                    title: on && edit ? 'Click again to undo' : 'Set Lead Status to ' + st + ' and Lead Funnel Time Stamp to today'
                };
            }),
            // Disqualified: Lead Funnel Outcome with the #133 prompt. A prompt only: nothing is blocked.
            showOutcome,
            outcomeOptions: [{ value: '', label: '--None--', selected: !outcome }].concat(
                values.map((v) => ({ value: v.value, label: v.label, selected: v.value === outcome }))
            ),
            outcomeMissing: showOutcome && !outcome
        };
    }

    // ---------------------------------------------------------------- list handlers

    pickBox(e) {
        const key = e.currentTarget.dataset.key;
        if (!key || key === this.box) return;
        this.box = key;
        this.filters = { ...DEFAULT_FILTERS }; // switching boxes resets the filters (canvas #151 C)
    }

    setFilter(name, value) {
        this.filters = { ...this.filters, [name]: value };
    }

    handleRecordFilter(e) {
        this.setFilter('record', e.target.value);
    }

    handleTypeFilter(e) {
        this.setFilter('type', e.target.value);
    }

    handleCeFilter(e) {
        this.setFilter('ce', e.target.value);
    }

    handleStatusFilter(e) {
        this.setFilter('status', e.target.value);
    }

    toggleSortOrder() {
        this.sortOrder = this.sortOrder === 'oldest' ? 'newest' : 'oldest';
    }

    handleCard(e) {
        const key = e.currentTarget.dataset.card;
        const p = this.people.find((x) => x.leadId === key);
        const othersCount = p && p.replies ? Math.max(0, p.replies.length - 1) : 0;
        const next = pickCard({ activeKey: this.effectiveKey, collapsed: this.collapsed }, key, othersCount);
        this.activeKey = next.activeKey;
        this.collapsed = next.collapsed;
    }

    handleChild(e) {
        this.activeKey = e.currentTarget.dataset.lead;
    }

    // ---------------------------------------------------------------- page handlers

    openLead() {
        const a = this.active;
        if (a) this.openRecord(a.leadId, 'Lead');
    }

    /** Console app: the record as a workspace tab; standard app: the record page (like the inbox's openRecord). */
    async openRecord(recordId, objectApiName) {
        if (!recordId) return;
        if (this.isConsole && this.isConsole.data) {
            try {
                await openTab({ recordId, focus: true });
                return;
            } catch {
                // fall through
            }
        }
        this[NavigationMixin.Navigate]({ type: 'standard__recordPage', attributes: { recordId, objectApiName, actionName: 'view' } });
    }

    /** Status button: Status + Lead Funnel Time Stamp = today; the filled one (set here) undoes it. */
    async handleStatus(e) {
        const a = this.active;
        const st = e.currentTarget.dataset.status;
        if (!a || !st || this.busy) return;
        const edit = this.edits[a.leadId];
        const undo = a.status === st && !!edit;
        const listedPerson = this.people.find((p) => p.leadId === a.leadId);
        this.busy = true;
        try {
            if (undo) {
                const prev = edit.prev;
                await saveSixSenseStatus({
                    leadId: a.leadId,
                    status: prev.status || null,
                    outcome: prev.outcome || '',
                    timeStamp: prev.timeStamp || null
                });
                const edits = { ...this.edits };
                delete edits[a.leadId];
                this.edits = edits;
                const outcomes = { ...this.outcomes };
                delete outcomes[a.leadId];
                this.outcomes = outcomes;
                this.toast('Undone: Lead Status and Lead Funnel Time Stamp are back to what they were.', 'success');
            } else {
                const today = todayPacific();
                await saveSixSenseStatus({ leadId: a.leadId, status: st, outcome: null, timeStamp: today });
                const prev = edit ? edit.prev : { status: a.status || null, outcome: a.outcome || null, timeStamp: a.timeStamp || null };
                this.edits = { ...this.edits, [a.leadId]: { prev, status: st, outcome: a.outcome || null, timeStamp: today } };
                if (listedPerson && !this.pinned[a.leadId]) this.pinned = { ...this.pinned, [a.leadId]: listedPerson };
                this.activeKey = a.leadId;
                this.toast(
                    'Lead Status set to ' + st + ' and Lead Funnel Time Stamp set to today. Replies from before today drop off the 6Sense list.',
                    'success'
                );
            }
            this.dispatchEvent(new CustomEvent('sixsensechanged'));
        } catch (err) {
            this.toast(errorText(err), 'error');
        } finally {
            this.busy = false;
        }
    }

    /** Lead Funnel Outcome (shown for Disqualified): saved on change; never required (canvas #133 prompt only). */
    async handleOutcome(e) {
        const a = this.active;
        const value = e.target.value || '';
        if (!a || this.busy) return;
        this.busy = true;
        try {
            await saveSixSenseStatus({ leadId: a.leadId, status: null, outcome: value, timeStamp: a.timeStamp || null });
            const edit = this.edits[a.leadId];
            if (edit) {
                this.edits = { ...this.edits, [a.leadId]: { ...edit, outcome: value || null } };
            } else {
                this.outcomes = { ...this.outcomes, [a.leadId]: value || null };
            }
            this.dispatchEvent(new CustomEvent('sixsensechanged'));
        } catch (err) {
            this.toast(errorText(err), 'error');
        } finally {
            this.busy = false;
        }
    }

    toast(message, variant) {
        this.dispatchEvent(new ShowToastEvent({ title: '6Sense', message, variant }));
    }
}
