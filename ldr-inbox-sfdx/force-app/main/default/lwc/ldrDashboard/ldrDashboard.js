import { LightningElement, api } from 'lwc';
import getDashboard from '@salesforce/apex/LdrInboxController.getDashboard';
import getMyDashboard from '@salesforce/apex/LdrInboxController.getMyDashboard';
import getSixSenseDashboard from '@salesforce/apex/LdrInboxController.getSixSenseDashboard';

/**
 * Boss View dashboard (canvas a111), modelled on the Salesforce "LDR Performance Dashboard": worked leads by Project
 * Coordinator and Lead Status (by Lead Funnel Time Stamp), opportunities created by each LDR, 12-month trends, plus
 * inbox numbers passed in from the inbox.
 */
// NanaWall brand palette (LDRInbox-NanaWall artboard).
// #123 palette snaps: #77123E -> blue-dark #47647D, #81826F -> tan-dark #908A81, sand #D6CFBC -> brand-tan #C6C1B0 in charts.
const LDR_COLORS = ['#4A6D22', '#00798F', '#9DCE64', '#47647D', '#6CA6C4', '#908A81', '#194D19', '#C6C1B0', '#3D3D3D'];
// Canvas dd24: a fixed colour per LDR (by first name), so each person keeps their colour across charts.
const LDR_COLOR_BY_FIRST = {
    Aqil: '#00798F',
    WeiWei: '#4A6D22',
    Yasmin: '#6CA6C4',
    Jahmanz: '#908A81',
    Jabir: '#47647D',
    Samantha: '#9DCE64',
    Aziz: '#BBBDBF'
};
const STATUS_COLORS = {
    Working: '#00798F',
    Qualified: '#4A6D22',
    Nurture: '#6CA6C4',
    New: '#BBBDBF',
    Unreachable: '#908A81',
    'Wrong profile': '#C6C1B0',
    Disqualified: '#C8102E',
    Bounced: '#47647D',
    'Close - No Further Action': '#707070'
};
// CE status -> [label, brand color] (canvas 9fed 6Sense Dashboard).
const CE_COLORS = {
    in_progress: ['In progress', '#6CA6C4'],
    qualified: ['Qualified', '#4A6D22'],
    human_review: ['Human review', '#9DCE64'],
    not_interested: ['Not interested', '#C8102E'],
    not_interested_now: ['Not interested now', '#47647D'],
    unresponsive: ['Unresponsive', '#BBBDBF'],
    bounced: ['Bounced', '#C6C1B0'],
    canceled: ['Canceled', '#908A81'],
    enrollment_error: ['Enrollment error', '#292929']
};
const SIX_OBJ = { both: 'Leads + Contacts', lead: 'Leads', contact: 'Contacts' };

function pct(a, b) {
    return b ? Math.round((a / b) * 100) + '%' : '—';
}

/** Hours -> "35 min" / "4.2 h" / "1.8 days" ("—" when null). */
function hours(h) {
    if (h === null || h === undefined) return '—';
    const n = Number(h);
    if (n < 1) return Math.max(1, Math.round(n * 60)) + ' min';
    return n < 24 ? n.toFixed(1) + ' h' : (n / 24).toFixed(1) + ' days';
}

const PERIODS = [
    { key: 'week', label: 'This week' },
    { key: 'month', label: 'This month' },
    { key: 'lastmonth', label: 'Last month' }
];

function errorText(e) {
    if (!e) return 'Unknown error';
    if (e.body && e.body.message) return e.body.message;
    return e.message || String(e);
}

function gradient(dir, parts) {
    const total = parts.reduce((a, x) => a + x[1], 0) || 1;
    let acc = 0;
    return (
        'linear-gradient(' + dir + ', ' +
        parts
            .map((x) => {
                const a0 = (acc / total) * 100;
                acc += x[1];
                return x[0] + ' ' + a0.toFixed(2) + '% ' + ((acc / total) * 100).toFixed(2) + '%';
            })
            .join(', ') +
        ')'
    );
}

/** `{ a: 1, b: { c: 2 } }` -> 3. Only numbers and nested objects count (a string would otherwise recurse forever). */
const sum = (o) => Object.values(o || {}).reduce((a, v) => a + (typeof v === 'number' ? v : v && typeof v === 'object' ? sum(v) : 0), 0);

/** A result's `asOf` -> "Oct 20, 3:05 PM" ('' when missing). */
function asOfText(result) {
    return result && result.asOf
        ? new Date(result.asOf).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
        : '';
}

export default class LdrDashboard extends LightningElement {
    @api inbox;
    /** 'team' (Boss View), 'my' (My Dashboard, canvas 55a9) or 'six' (6Sense Dashboard, canvas 9fed). */
    @api mode = 'team';
    /**
     * My Dashboard: whose (the "View as" user for admins). The parent keeps this component mounted when an admin
     * switches "View as", so a change reloads the data.
     */
    @api
    get userId() {
        return this._userId;
    }
    set userId(value) {
        const changed = value !== this._userId;
        this._userId = value;
        if (changed && this._connected && this.isMy) this.load();
    }
    /** My Dashboard: suggested actions from the inbox ({ key, isHeader | isItem, ... }). */
    @api actions;
    _userId;
    _connected = false;
    // Bumped on every load(); a response from an older load is dropped so it can't overwrite a newer one.
    _loadSeq = 0;
    data;
    my;
    error = '';
    loading = true;
    six;
    sixObj = 'both';
    period = 'month';
    pc = 'All';

    connectedCallback() {
        this._connected = true;
        this.load();
    }

    disconnectedCallback() {
        this._connected = false;
    }

    async load() {
        const seq = ++this._loadSeq;
        this.loading = true;
        try {
            let result;
            if (this.isMy) result = await getMyDashboard({ userId: this._userId || null });
            else if (this.isSix) result = await getSixSenseDashboard();
            else result = await getDashboard();
            if (seq !== this._loadSeq) return;
            if (this.isMy) this.my = result;
            else if (this.isSix) this.six = result;
            else this.data = result;
            this.error = '';
        } catch (e) {
            if (seq === this._loadSeq) this.error = errorText(e);
        } finally {
            if (seq === this._loadSeq) this.loading = false;
        }
    }

    get hasData() {
        return this.isTeam && !!this.data;
    }

    get isTeam() {
        return !this.isMy && !this.isSix;
    }

    // ---------------------------------------------------------------- Speed (canvas 9fed)

    get speedNote() {
        const rows = (this.data && this.data.speed) || [];
        const n = rows.reduce((a, r) => a + (r.claimed || 0), 0);
        return n + ' claimed since ' + ((this.data && this.data.speedSince) || 'go-live');
    }

    get speedRows() {
        return ((this.data && this.data.speed) || [])
            .filter((r) => this.pc === 'All' || r.name === this.pc)
            .map((r) => ({
                key: r.name,
                name: r.name,
                claimed: r.claimed,
                sameDay: r.claimed ? r.sameDay + ' (' + pct(r.sameDay, r.claimed) + ')' : '—',
                nextBd: r.nextBusinessDay,
                weekend: r.weekendToMonday,
                firstOut: hours(r.avgFirstOutreachHours),
                toQual: hours(r.avgToQualifiedHours)
            }));
    }

    get speedKpis() {
        const rows = ((this.data && this.data.speed) || []).filter((r) => this.pc === 'All' || r.name === this.pc);
        const t = rows.reduce(
            (a, r) => ({ c: a.c + (r.claimed || 0), s: a.s + (r.sameDay || 0), n: a.n + (r.nextBusinessDay || 0), w: a.w + (r.weekendToMonday || 0) }),
            { c: 0, s: 0, n: 0, w: 0 }
        );
        const outs = rows.filter((r) => r.avgFirstOutreachHours !== null && r.avgFirstOutreachHours !== undefined);
        const wAvg = outs.length ? outs.reduce((a, r) => a + r.avgFirstOutreachHours * (r.claimed || 1), 0) / outs.reduce((a, r) => a + (r.claimed || 1), 0) : null;
        return [
            { key: 's1', label: 'Claimed the same day', value: pct(t.s, t.c), sub: t.s + ' of ' + t.c, cls: 'db-mini-v db-green' },
            { key: 's2', label: 'Next business day', value: pct(t.n, t.c), sub: t.n + ' submissions', cls: 'db-mini-v' },
            { key: 's3', label: 'Weekend → claimed Monday', value: pct(t.w, t.c), sub: t.w + ' submissions', cls: 'db-mini-v db-grey' },
            { key: 's4', label: 'Avg time to first outreach', value: hours(wAvg), sub: 'from submission', cls: 'db-mini-v db-blue' }
        ];
    }

    get mySpeed() {
        const s = this.my && this.my.speed;
        if (!s) return [];
        return [
            {
                key: 'y1',
                label: 'Claimed the same day',
                value: pct(s.sameDay, s.claimed),
                sub: s.claimed
                    ? s.sameDay + ' of ' + s.claimed + ' · team ' + pct(this.my.teamSameDay, this.my.teamClaimed)
                    : 'none claimed since ' + ((this.my && this.my.speedSince) || 'go-live'),
                cls: 'db-mini-v db-green'
            },
            { key: 'y2', label: 'Avg time to first outreach', value: hours(s.avgFirstOutreachHours), sub: 'from submission', cls: 'db-mini-v db-blue' },
            { key: 'y3', label: 'Avg time to Qualified / converted', value: hours(s.avgToQualifiedHours), sub: 'from submission', cls: 'db-mini-v' }
        ];
    }

    get mySpeedNote() {
        return 'Since ' + ((this.my && this.my.speedSince) || 'go-live') + ': Form Submissions you claimed. First outreach = your first Task on the Lead / Contact after the submission.';
    }

    // ---------------------------------------------------------------- 6Sense Dashboard (canvas 9fed)

    get isSix() {
        return this.mode === 'six';
    }

    get hasSix() {
        return this.isSix && !!this.six;
    }

    get sixAsOf() {
        return asOfText(this.six);
    }

    get sixError() {
        return this.six && this.six.error ? this.six.error : '';
    }

    get sixObjs() {
        return Object.keys(SIX_OBJ).map((k) => ({ key: k, label: SIX_OBJ[k], cls: 'db-pill' + (k === this.sixObj ? ' db-pill-on' : '') }));
    }

    handleSixObj(e) {
        this.sixObj = e.currentTarget.dataset.key;
    }

    sixPick(byObj) {
        const o = byObj || {};
        const maps = this.sixObj === 'both' ? [o.lead || {}, o.contact || {}] : [o[this.sixObj] || {}];
        const out = {};
        maps.forEach((m) =>
            Object.keys(m).forEach((k) => {
                out[k] = (out[k] || 0) + m[k];
            })
        );
        return out;
    }

    get sixKpis() {
        const l = this.sixPick(this.six ? this.six.last30 : {});
        const total = Object.values(l).reduce((a, b) => a + b, 0);
        const responded = ['qualified', 'human_review', 'not_interested', 'not_interested_now'].reduce((a, k) => a + (l[k] || 0), 0);
        const p = (n) => pct(n, total);
        return [
            { key: 'x1', label: 'Enrolled · 30 days', value: total, sub: SIX_OBJ[this.sixObj], cls: 'db-kpi-v' },
            { key: 'x2', label: 'In progress', value: l.in_progress || 0, sub: p(l.in_progress || 0) + ' still in sequence', cls: 'db-kpi-v db-blue' },
            { key: 'x3', label: 'Responded', value: responded, sub: p(responded) + ' of enrolled', cls: 'db-kpi-v db-plum' },
            { key: 'x4', label: 'Qualified', value: l.qualified || 0, sub: p(l.qualified || 0) + ' of enrolled', cls: 'db-kpi-v db-green' },
            { key: 'x5', label: 'Human review', value: l.human_review || 0, sub: 'need a person', cls: 'db-kpi-v db-amber' },
            { key: 'x6', label: 'Unresponsive', value: l.unresponsive || 0, sub: p(l.unresponsive || 0) + ' · bounced ' + (l.bounced || 0), cls: 'db-kpi-v db-grey' }
        ];
    }

    get sixWeeks() {
        const weeks = ((this.six && this.six.weeks) || []).map((w) => ({ label: w.label, m: this.sixPick(w.byObject) }));
        weeks.forEach((w) => {
            w.t = Object.values(w.m).reduce((a, b) => a + b, 0);
        });
        const max = Math.max(1, ...weeks.map((w) => w.t));
        return weeks.map((w, i) => {
            const parts = Object.keys(CE_COLORS)
                .filter((k) => w.m[k])
                .map((k) => [CE_COLORS[k][1], w.m[k]]);
            return {
                key: 'w' + i,
                label: w.label,
                total: w.t,
                tip: Object.keys(CE_COLORS)
                    .filter((k) => w.m[k])
                    .map((k) => CE_COLORS[k][0] + ': ' + w.m[k])
                    .join(', '),
                barStyle: 'height:' + Math.max(2, Math.round((w.t / max) * 140)) + 'px; background:' + (parts.length ? gradient('to top', parts) : '#EBEBEB') + ';'
            };
        });
    }

    get sixLegend() {
        return Object.keys(CE_COLORS).map((k) => ({ key: k, label: CE_COLORS[k][0], swatch: 'background:' + CE_COLORS[k][1] + ';' }));
    }

    get sixCampaigns() {
        const list = ((this.six && this.six.campaigns) || []).filter((c) => this.sixObj === 'both' || c.obj === this.sixObj);
        const merged = {};
        list.forEach((c) => {
            merged[c.name] = merged[c.name] || { name: c.name, n: 0, obj: c.obj };
            merged[c.name].n += c.n || 0;
        });
        const top = Object.values(merged)
            .sort((a, b) => b.n - a.n)
            .slice(0, 10);
        const max = Math.max(1, ...top.map((c) => c.n));
        return top.map((c) => ({
            key: c.name,
            name: c.name,
            n: c.n,
            fillStyle: 'height:100%; width:' + ((c.n / max) * 100).toFixed(1) + '%; background:' + (c.obj === 'contact' ? '#3D3D3D' : '#00798F') + ';'
        }));
    }

    get sixReview() {
        return ((this.six && this.six.review) || []).map((r) => ({ ...r, key: r.name }));
    }

    get sixReviewEmpty() {
        return this.sixReview.length === 0;
    }

    // ---------------------------------------------------------------- My Dashboard

    get isMy() {
        return this.mode === 'my';
    }

    get hasMy() {
        return this.isMy && !!this.my;
    }

    get myTitle() {
        return 'My Dashboard · ' + (this.my ? this.my.name : '');
    }

    get myAsOf() {
        return asOfText(this.my);
    }

    get myLeads() {
        return this.my ? (this.my.leads || {})[this.period] || {} : {};
    }

    get myWorked() {
        return sum(this.myLeads);
    }

    get myKpis() {
        const leads = this.myLeads;
        const worked = this.myWorked;
        const q = leads.Qualified || 0;
        const working = this.inboxWorking;
        return [
            { key: 'm1', label: 'Worked leads · ' + this.periodLabel, value: worked, sub: 'Lead Funnel Time Stamp', cls: 'db-kpi-v' },
            { key: 'm2', label: 'Qualified · ' + this.periodLabel, value: q, sub: worked ? pct(q, worked) + ' of worked' : '—', cls: 'db-kpi-v db-green' },
            { key: 'm3', label: 'Opportunities created · ' + this.periodLabel, value: (this.my.opps || {})[this.period] || 0, sub: 'created by you', cls: 'db-kpi-v db-blue' },
            { key: 'm4', label: 'Claimed, working now', value: working, sub: 'in your Mine tab', cls: 'db-kpi-v db-amber' }
        ];
    }

    get inboxWorking() {
        return this.inbox && typeof this.inbox.mineWorking === 'number' ? this.inbox.mineWorking : '—';
    }

    get myStatusStyle() {
        const leads = this.myLeads;
        const parts = Object.keys(STATUS_COLORS)
            .filter((st) => leads[st])
            .map((st) => [STATUS_COLORS[st], leads[st]]);
        return 'width:100%; height:100%; background:' + (parts.length ? gradient('to right', parts) : '#D8D8D8') + ';';
    }

    get myStatusLegend() {
        const leads = this.myLeads;
        return Object.keys(STATUS_COLORS)
            .filter((st) => leads[st])
            .map((st) => ({ key: st, label: st + ' ' + leads[st], swatch: 'background:' + STATUS_COLORS[st] + ';' }));
    }

    get myShareLine() {
        const team = this.my ? (this.my.teamWorked || {})[this.period] || 0 : 0;
        return team ? 'That is ' + pct(this.myWorked, team) + ' of the team’s ' + team + ' worked leads ' + this.periodLabel.toLowerCase() + '.' : '';
    }

    myTrend(title, months, color) {
        const name = this.my ? this.my.name : '';
        const vals = (months || []).map((m) => [m.label, (m.byLdr || {})[name] || 0]);
        const max = Math.max(1, ...vals.map((v) => v[1]));
        return {
            key: title,
            title,
            bars: vals.map((v, i) => ({
                key: title + i,
                label: v[0],
                total: v[1],
                tip: '',
                barStyle: 'height:' + Math.max(2, Math.round((v[1] / max) * 95)) + 'px; background:' + color + ';'
            }))
        };
    }

    get myTrends() {
        if (!this.my) return [];
        return [
            this.myTrend('Your worked leads by month', this.my.monthlyLeads, '#4A6D22'),
            this.myTrend('Your opportunities created by month', this.my.monthlyOpps, '#00798F')
        ];
    }

    get actionItems() {
        return this.actions || [];
    }

    get actionCount() {
        return this.actionItems.filter((a) => a.isHeader && a.counts).reduce((n, a) => n + a.count, 0);
    }

    get noActions() {
        return this.actionItems.length === 0;
    }

    openAction(e) {
        const a = this.actionItems.find((x) => x.key === e.currentTarget.dataset.key);
        if (!a) return;
        this.dispatchEvent(new CustomEvent('openrow', { detail: { tab: a.tab, id: a.id, prospectList: a.prospectList || null } }));
    }

    get colorOf() {
        const m = {};
        ((this.data && this.data.ldrs) || []).forEach((n, i) => {
            m[n] = LDR_COLOR_BY_FIRST[String(n).split(' ')[0]] || LDR_COLORS[i % LDR_COLORS.length];
        });
        return m;
    }

    pick(obj) {
        const o = obj || {};
        if (this.pc === 'All') return o;
        return o[this.pc] !== undefined ? { [this.pc]: o[this.pc] } : {};
    }

    get periodLabel() {
        return (PERIODS.find((p) => p.key === this.period) || {}).label;
    }

    get periods() {
        return PERIODS.map((p) => ({ ...p, cls: 'db-pill' + (p.key === this.period ? ' db-pill-on' : '') }));
    }

    handlePeriod(e) {
        this.period = e.currentTarget.dataset.key;
    }

    get pcOptions() {
        const names = (this.data && this.data.ldrs) || [];
        return [{ value: 'All', label: 'Project Coordinator: All' }].concat(names.map((n) => ({ value: n, label: n }))).map((o) => ({
            ...o,
            selected: o.value === this.pc
        }));
    }

    handlePc(e) {
        this.pc = e.target.value;
    }

    get asOf() {
        return asOfText(this.data);
    }

    get leads() {
        return this.pick(this.data ? (this.data.leads || {})[this.period] : {});
    }

    get opps() {
        return this.pick(this.data ? (this.data.opps || {})[this.period] : {});
    }

    get inboxData() {
        return this.inbox || { rows: [], unclaimedNow: 0, oldestWaiting: '' };
    }

    get kpis() {
        const leads = this.leads;
        const qualified = Object.values(leads).reduce((a, o) => a + (o.Qualified || 0), 0);
        return [
            { key: 'k1', label: 'Worked leads · ' + this.periodLabel, value: sum(leads), sub: 'by Lead Funnel Time Stamp', cls: 'db-kpi-v' },
            { key: 'k2', label: 'Qualified · ' + this.periodLabel, value: qualified, sub: 'Lead Status = Qualified', cls: 'db-kpi-v db-green' },
            { key: 'k3', label: 'Opportunities created · ' + this.periodLabel, value: sum(this.opps), sub: 'created by the LDR', cls: 'db-kpi-v db-blue' },
            { key: 'k4', label: 'Unclaimed now', value: this.inboxData.unclaimedNow, sub: 'in the inbox', cls: 'db-kpi-v db-red' }
        ];
    }

    get leadBars() {
        const leads = this.leads;
        const totals = Object.keys(leads)
            .map((n) => [n, sum(leads[n])])
            .sort((a, b) => b[1] - a[1]);
        const max = Math.max(1, ...totals.map((x) => x[1]));
        return totals.map(([name, total]) => {
            const parts = Object.keys(STATUS_COLORS)
                .filter((st) => leads[name][st])
                .map((st) => [STATUS_COLORS[st], leads[name][st]]);
            return {
                key: name,
                name,
                total,
                fillStyle: 'width:' + ((total / max) * 100).toFixed(1) + '%; background:' + (parts.length ? gradient('to right', parts) : '#D8D8D8') + ';'
            };
        });
    }

    get statusLegend() {
        const used = new Set();
        Object.values(this.leads).forEach((o) => Object.keys(o).forEach((k) => used.add(k)));
        return Object.keys(STATUS_COLORS)
            .filter((st) => used.has(st))
            .map((st) => ({ key: st, label: st, swatch: 'background:' + STATUS_COLORS[st] + ';' }));
    }

    get oppList() {
        const o = this.opps;
        const colors = this.colorOf;
        return Object.keys(o)
            .map((n) => ({ key: n, name: n, n: o[n], swatch: 'background:' + (colors[n] || '#707070') + ';' }))
            .sort((a, b) => b.n - a.n);
    }

    get oppTotal() {
        return sum(this.opps);
    }

    get donutStyle() {
        const list = this.oppList;
        const total = this.oppTotal || 1;
        const colors = this.colorOf;
        let acc = 0;
        const g = list.length
            ? list
                  .map((x) => {
                      const a0 = (acc / total) * 360;
                      acc += x.n;
                      return (colors[x.name] || '#707070') + ' ' + a0.toFixed(1) + 'deg ' + ((acc / total) * 360).toFixed(1) + 'deg';
                  })
                  .join(', ')
            : '#D8D8D8 0deg 360deg';
        return 'background: conic-gradient(' + g + ');';
    }

    trend(title, months) {
        const names = (this.data && this.data.ldrs) || [];
        const colors = this.colorOf;
        const bars = (months || []).map((m) => {
            const o = this.pick(m.byLdr || {});
            const parts = names.filter((n) => o[n]).map((n) => [colors[n], o[n]]);
            const total = parts.reduce((a, x) => a + x[1], 0);
            return { label: m.label, total, parts, tip: Object.keys(o).map((n) => n + ': ' + o[n]).join(', ') };
        });
        const max = Math.max(1, ...bars.map((b) => b.total));
        return {
            key: title,
            title,
            bars: bars.map((b, i) => ({
                key: title + i,
                label: b.label,
                total: b.total,
                tip: b.tip,
                barStyle: 'height:' + Math.max(2, Math.round((b.total / max) * 120)) + 'px; background:' + (b.parts.length ? gradient('to top', b.parts) : '#D8D8D8') + ';'
            }))
        };
    }

    get trends() {
        if (!this.data) return [];
        return [
            this.trend('Worked leads by month (last 12 months)', this.data.monthlyLeads),
            this.trend('Opportunities created by month (last 12 months)', this.data.monthlyOpps)
        ];
    }

    get ldrLegend() {
        const colors = this.colorOf;
        return ((this.data && this.data.ldrs) || [])
            .filter((n) => this.pc === 'All' || n === this.pc)
            .map((n) => ({ key: n, label: n, swatch: 'background:' + colors[n] + ';' }));
    }

    get inboxRows() {
        // Canvas: one row per dashboard LDR (zeros included), plus anyone else the inbox saw.
        const by = {};
        ((this.data && this.data.ldrs) || []).forEach((n) => {
            by[n] = { name: n, working: 0, finished: 0, noOut: 0, unclaimedCoord: 0, outbound: 0 };
        });
        (this.inboxData.rows || []).forEach((r) => {
            by[r.name] = { ...(by[r.name] || {}), ...r };
        });
        return Object.values(by)
            .filter((r) => this.pc === 'All' || r.name === this.pc)
            .map((r) => ({ ...r, key: r.name, noOutCls: r.noOut ? 'db-cell db-red db-strong' : 'db-cell' }));
    }
}
