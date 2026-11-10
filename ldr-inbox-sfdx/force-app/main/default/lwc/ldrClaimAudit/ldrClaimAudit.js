import { LightningElement } from 'lwc';
import getClaimAudit from '@salesforce/apex/LdrInboxController.getClaimAudit';

/**
 * Boss View > Claim Audit (canvas #145B): every LDR's claims since Oct 6, 2026 and the claimer's first outbound email
 * after the claim, live from Salesforce (Apex getClaimAudit, admins only). By Claimer totals + the flagged records
 * (no email / first email more than 24 hours after the claim), filtered here.
 */
const SEG_COLOR = { ok: '#4A6D22', pending: '#C2C2C2', late: '#E0A526', none: '#C8102E' };
const FILTER_KEYS = ['q', 'claimer', 'status', 'rtype', 'lstatus', 'conv'];

function errorText(e) {
    if (!e) return 'Unknown error';
    if (e.body && e.body.message) return e.body.message;
    return e.message || String(e);
}

function fmt(v) {
    return v ? new Date(v).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';
}

function recUrl(obj, id) {
    return id ? window.location.origin + '/lightning/r/' + obj + '/' + id + '/view' : '';
}

function options(values, allLabel, selected) {
    return [{ value: '', label: allLabel }].concat(values.map((v) => ({ value: v, label: v }))).map((o) => ({ ...o, selected: o.value === selected }));
}

function uniqSorted(list) {
    return Array.from(new Set(list.filter(Boolean))).sort();
}

export default class LdrClaimAudit extends LightningElement {
    data;
    error;
    loading = true;
    q = '';
    claimer = '';
    status = '';
    rtype = '';
    lstatus = '';
    conv = '';

    connectedCallback() {
        this.load();
    }

    async load() {
        this.loading = true;
        try {
            this.data = await getClaimAudit({ fromDate: null });
            this.error = undefined;
        } catch (e) {
            this.error = errorText(e);
        } finally {
            this.loading = false;
        }
    }

    get hasData() {
        return !!this.data;
    }

    get subtitle() {
        const d = this.data;
        if (!d) return '';
        const asOf = new Date(d.asOf).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
        return 'Form Submissions and Website Instant Estimates claimed ' + d.rangeLabel +
            ', and the claimer’s first outbound email to the customer. Live from Salesforce, ' + asOf + '.' +
            (d.capped ? ' Only the newest 5,000 claims were read.' : '');
    }

    claimerRow(r, isTotal) {
        const rate = r.checked ? (r.late + r.none) / r.checked : 0;
        return {
            ...r,
            key: isTotal ? '__team' : r.claimer,
            rateLabel: Math.round(rate * 100) + '%',
            rateCls: 'ca-rate' + (rate >= 0.25 ? ' ca-rate-high' : ''),
            rowCls: isTotal ? 'ca-total' : '',
            segs: ['ok', 'pending', 'late', 'none'].map((k) => ({
                key: k,
                style: 'width:' + (r.checked ? (100 * r[k]) / r.checked : 0).toFixed(2) + '%;background:' + SEG_COLOR[k]
            }))
        };
    }

    /** Claimers (Apex sorts them by late-or-none rate, highest first), then the Whole team row. */
    get claimers() {
        const d = this.data;
        if (!d) return [];
        return (d.claimers || []).map((r) => this.claimerRow(r, false)).concat(d.team ? [this.claimerRow(d.team, true)] : []);
    }

    get allRows() {
        return (this.data && this.data.rows) || [];
    }

    get filtered() {
        const q = this.q.trim().toLowerCase();
        return this.allRows.filter((r) => {
            if (this.claimer && r.claimer !== this.claimer) return false;
            if (this.status && r.status !== this.status) return false;
            if (this.rtype && r.formRecordType !== this.rtype) return false;
            if (this.lstatus && (r.leadStatus || '(blank)') !== this.lstatus) return false;
            if (this.conv && !(r.converted || '').startsWith(this.conv)) return false;
            if (!q) return true;
            return [r.name, r.email, r.firstEmailSubject, r.claimer, r.oppName, r.coordinator, r.leadStatus, r.outcome]
                .some((v) => (v || '').toLowerCase().includes(q));
        });
    }

    get rows() {
        return this.filtered.map((r) => ({
            key: r.key,
            status: r.status,
            statusCls: 'ca-pill ' + (r.status === 'No email' ? 'ca-pill-none' : 'ca-pill-late'),
            claimer: r.claimer || '—',
            name: r.name || '—',
            email: r.email || '—',
            type: r.type,
            submitted: fmt(r.submitted),
            claimed: fmt(r.claimed),
            firstEmail: fmt(r.firstEmail),
            firstEmailTitle: r.firstEmailSubject || '',
            hours: r.hoursToEmail == null ? '—' : Number(r.hoursToEmail).toFixed(1),
            exact: r.claimTimeExact ? 'Yes' : 'No (date only)',
            coordinator: r.coordinator || '—',
            leadStatus: r.leadStatus || '—',
            outcome: r.outcome || '—',
            otherEmail: r.emailedBySomeoneElse || '',
            recordUrl: recUrl(r.objectName, r.key),
            formRecordType: r.formRecordType || '—',
            hasPerson: !!r.personId,
            personUrl: recUrl(r.personType, r.personId),
            personType: r.personType,
            converted: r.converted || 'No',
            hasOpp: !!r.oppId,
            oppUrl: recUrl('Opportunity', r.oppId),
            oppName: r.oppName
        }));
    }

    get noRows() {
        return this.hasData && this.filtered.length === 0;
    }

    get countLabel() {
        return this.filtered.length + ' of ' + this.allRows.length + ' flagged records shown';
    }

    get claimerOptions() {
        return options(uniqSorted(this.allRows.map((r) => r.claimer)), 'All claimers', this.claimer);
    }

    get statusOptions() {
        return options(['No email', 'Late (>24h)'], 'All statuses', this.status);
    }

    get rtypeOptions() {
        return options(['Lead', 'Contact'], 'Leads and contacts', this.rtype);
    }

    get lstatusOptions() {
        const vals = uniqSorted(this.allRows.map((r) => r.leadStatus));
        if (this.allRows.some((r) => !r.leadStatus)) vals.push('(blank)');
        return options(vals, 'All lead statuses', this.lstatus);
    }

    get convOptions() {
        return [
            { value: '', label: 'Converted or not' },
            { value: 'Yes', label: 'Converted: Yes' },
            { value: 'No', label: 'Converted: No' }
        ].map((o) => ({ ...o, selected: o.value === this.conv }));
    }

    get hasFilters() {
        return FILTER_KEYS.some((k) => !!this[k]);
    }

    handleFilter(e) {
        this[e.target.dataset.f] = e.target.value || '';
    }

    clearFilters() {
        FILTER_KEYS.forEach((k) => {
            this[k] = '';
        });
    }
}
