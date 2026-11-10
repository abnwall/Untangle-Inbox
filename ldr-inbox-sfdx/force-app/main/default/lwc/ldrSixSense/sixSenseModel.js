/**
 * 6Sense tab (canvas #151, #152 K, #155 A): pure list logic, no LWC imports, so it can be unit tested in Node.
 * Input = SixSensePerson rows from LdrInboxController.getSixSenseReplies (replies newest first).
 */

/** CE Lead Status (sixsense_ce__status__c) API value -> label (canvas SS_CE). */
export const CE_LABEL = {
    qualified: 'Qualified',
    human_review: 'Human Review',
    not_interested: 'Not Interested',
    not_interested_now: 'Not Interested Now',
    unresponsive: 'Unresponsive',
    in_progress: 'In Progress',
    not_started: 'Not Started',
    bounced: 'Bounced',
    canceled: 'Canceled',
    stop_responding: 'Stop Responding',
    import_error: 'Import Error',
    enrollment_error: 'Enrollment Error',
    unsynced: 'Unsynced'
};

/** Same colours as the Prospects 6sense tags (ldrInbox.js CE_STATUS): [fill, text]. */
export const CE_COLOR = {
    in_progress: ['#2F6DAB', '#FFFFFF'],
    not_started: ['#6556B8', '#FFFFFF'],
    qualified: ['#2E8452', '#FFFFFF'],
    human_review: ['#E0A526', '#3D2A00'],
    unresponsive: ['#707070', '#FFFFFF'],
    not_interested: ['#C8102E', '#FFFFFF'],
    not_interested_now: ['#B0477A', '#FFFFFF'],
    canceled: ['#1F7F86', '#FFFFFF'],
    bounced: ['#5B3E9E', '#FFFFFF'],
    enrollment_error: ['#3D3D3D', '#FFFFFF']
};
const CE_COLOR_NONE = ['#F5F5F5', '#3D3D3D'];

/** Card groups in Aqil's order; everything else is Other (canvas #151 E). */
export const GROUPS = [
    ['qualified', 'Qualified'],
    ['human_review', 'Human Review'],
    ['not_interested', 'Not Interested'],
    ['not_interested_now', 'Not Interested Now'],
    ['other', 'Other']
];
const GROUP_KEYS = GROUPS.map((g) => g[0]).filter((k) => k !== 'other');

/** Customer type -> [tag fill, tag text, card accent] (canvas SS_TYPE_COL). */
export const TYPE_COLOR = {
    Contractor: ['#A24E1F', '#FFFFFF', '#A24E1F'],
    Architect: ['#3E6E9E', '#FFFFFF', '#3E6E9E'],
    'Business Owner': ['#7C5BA6', '#FFFFFF', '#7C5BA6'],
    Homeowner: ['#00798F', '#FFFFFF', '#00798F'],
    Unknown: ['#F5F5F5', '#707070', '#C2C2C2']
};

export const DEFAULT_FILTERS = Object.freeze({ record: 'All', type: 'All', ce: 'All', status: 'All' });

const PT = 'America/Los_Angeles';

/** 15-character form, so 15- and 18-character Ids compare equal. */
export function sameId(a, b) {
    return !!a && !!b && String(a).slice(0, 15) === String(b).slice(0, 15);
}

/** 'mine' (Project Coordinator is the viewer), 'unassigned' (blank / not one of the six LDRs), or null. */
export function boxOf(p, viewerId) {
    if (sameId(p.coordinatorId, viewerId)) return 'mine';
    return p.unassigned ? 'unassigned' : null;
}

export function boxRows(people, box, viewerId) {
    return (people || []).filter((p) => boxOf(p, viewerId) === box);
}

export function boxCounts(people, viewerId) {
    return { mine: boxRows(people, 'mine', viewerId).length, unassigned: boxRows(people, 'unassigned', viewerId).length };
}

export function groupOf(p) {
    return GROUP_KEYS.includes(p.ceStatus) ? p.ceStatus : 'other';
}

export function ceInfo(status) {
    const c = CE_COLOR[status] || CE_COLOR_NONE;
    return { label: CE_LABEL[status] || titleCase(status) || 'Blank', bg: c[0], fg: c[1] };
}

/** "rina_x" -> "Rina X" for CE values the map doesn't know. */
function titleCase(v) {
    return (v || '')
        .split(/[_\s]+/)
        .filter(Boolean)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
}

/** "6S.LN.A.6S.S.Grade_B.202512-Rina" -> "Rina" (the card's sender tag). */
export function senderOf(campaign) {
    const m = (campaign || '').match(/-(Rina|Emily)\b/i);
    return m ? m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase() : '';
}

export function customerTypeOf(leadType) {
    return ['Homeowner', 'Contractor', 'Architect', 'Business Owner'].includes(leadType) ? leadType : 'Unknown';
}

function timeOf(v) {
    const t = v ? new Date(v).getTime() : NaN;
    return Number.isNaN(t) ? 0 : t;
}

/** Record · Type · CE Lead Status · Status (canvas #151 D). Record is always Lead here. */
export function applyFilters(rows, f) {
    const flt = { ...DEFAULT_FILTERS, ...(f || {}) };
    return rows
        .filter(() => flt.record === 'All' || flt.record === 'Lead')
        .filter((p) => flt.type === 'All' || (p.leadType || '') === flt.type)
        .filter((p) => flt.status === 'All' || (p.status || '(blank)') === flt.status)
        .filter((p) => flt.ce === 'All' || (p.ceStatus || '(blank)') === flt.ce);
}

/** Newest reply first; 'oldest' flips it (the Date button). */
export function sortByLatest(rows, order) {
    const dir = order === 'oldest' ? 1 : -1;
    return rows.slice().sort((x, y) => dir * (timeOf(x.latestAt) - timeOf(y.latestAt)));
}

/** Non-empty groups in GROUPS order, each sorted by the newest reply. */
export function buildGroups(rows, order) {
    const sorted = sortByLatest(rows, order);
    return GROUPS.map(([key, label]) => ({ key, label, people: sorted.filter((p) => groupOf(p) === key) })).filter(
        (g) => g.people.length > 0
    );
}

/** The people in list order (first one = default selection). */
export function orderedPeople(rows, order) {
    return buildGroups(rows, order).flatMap((g) => g.people);
}

function uniq(list) {
    return Array.from(new Set(list));
}

/** Filter options from the box's rows (canvas ssRecordOptions / ssTypeOptions / ssStatusOptions / ssCeOptions). */
export function filterOptions(rows) {
    const ceOrder = GROUP_KEYS;
    const ceValues = uniq(rows.map((p) => p.ceStatus || '(blank)'));
    ceValues.sort((x, y) => {
        const ix = ceOrder.indexOf(x);
        const iy = ceOrder.indexOf(y);
        return (ix === -1 ? 99 : ix) - (iy === -1 ? 99 : iy) || ceInfo(x).label.localeCompare(ceInfo(y).label);
    });
    return {
        record: [
            { value: 'All', label: 'Record: All' },
            { value: 'Lead', label: 'Lead' }
        ],
        type: [{ value: 'All', label: 'Type: All' }].concat(
            uniq(rows.map((p) => p.leadType).filter(Boolean))
                .sort()
                .map((x) => ({ value: x, label: x }))
        ),
        status: [{ value: 'All', label: 'Status: All' }].concat(
            uniq(rows.map((p) => p.status || '(blank)'))
                .sort()
                .map((x) => ({ value: x, label: x === '(blank)' ? 'Without Status' : x }))
        ),
        ce: [{ value: 'All', label: 'CE Lead Status: All' }].concat(
            ceValues.map((x) => ({ value: x, label: x === '(blank)' ? 'Without CE Lead Status' : ceInfo(x).label }))
        )
    };
}

/** Empty-list text (canvas ssEmptyText). */
export function emptyText(boxCount, filteredCount, box) {
    if (boxCount && !filteredCount) return 'Nothing here with these filters.';
    return box === 'mine'
        ? 'No 6sense replies for you right now. Unassigned has the ones without one of the LDRs as Project Coordinator.'
        : 'No unassigned 6sense replies right now.';
}

export function moreLabel(n) {
    return n + ' more email' + (n === 1 ? '' : 's');
}

function preview(text, max) {
    const t = (text || '').replace(/\s+/g, ' ').trim();
    return t.length > max ? t.slice(0, max) + '…' : t;
}

/** Card date: "12m" / "3h" within a day, else "Oct 27" (Pacific) (canvas ssAgeLabel). */
export function ageLabel(v, now) {
    const t = timeOf(v);
    if (!t) return '';
    const m = Math.max(0, Math.round(((now || Date.now()) - t) / 60000));
    if (m < 60) return m + 'm';
    if (m < 1440) return Math.round(m / 60) + 'h';
    return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: PT });
}

/** "10/27/2026 1:07 PM" in Pacific. */
export function fmtDateTime(v) {
    const t = timeOf(v);
    if (!t) return '';
    const d = new Date(t);
    return (
        d.toLocaleDateString('en-US', { timeZone: PT }) +
        ' ' +
        d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: PT })
    );
}

/** Date "2026-10-27" -> "10/27/2026"; blank -> "—". */
export function fmtDate(d) {
    if (!d) return '—';
    const p = String(d).split('-');
    return p.length === 3 ? +p[1] + '/' + +p[2] + '/' + p[0] : String(d);
}

/** (xxx) xxx-xxxx for 10 digits (after a leading 1); otherwise as entered. */
export function formatPhone(p) {
    const dg = (p || '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
    return dg.length === 10 ? '(' + dg.slice(0, 3) + ') ' + dg.slice(3, 6) + '-' + dg.slice(6) : p || '';
}

/**
 * The list column: group headers, one card per person, and (for the selected card, unless collapsed) its earlier
 * replies as child rows (canvas ssVisible).
 * @param rows the box's people after filters
 * @param opts { order, activeKey, collapsed: { leadId: true }, now }
 */
export function buildListItems(rows, opts) {
    const o = opts || {};
    const collapsed = o.collapsed || {};
    const items = [];
    buildGroups(rows, o.order).forEach((g) => {
        items.push({
            key: 'hdr-' + g.key,
            isHeader: true,
            label: g.label,
            count: g.people.length,
            cls: items.length ? 'ss-group-head' : 'ss-group-head ss-group-head-first'
        });
        g.people.forEach((p) => {
            const replies = p.replies || [];
            const latest = replies[0] || {};
            const others = replies.slice(1);
            const on = p.leadId === o.activeKey;
            const expanded = on && others.length > 0 && !collapsed[p.leadId];
            const ct = customerTypeOf(p.leadType);
            const tc = TYPE_COLOR[ct];
            const ce = ceInfo(p.ceStatus);
            const sender = senderOf(p.ceCampaign);
            items.push({
                key: p.leadId,
                isCard: true,
                leadId: p.leadId,
                name: p.name,
                ageLabel: ageLabel(p.latestAt, o.now),
                customerType: ct,
                hasTypeTag: ct !== 'Unknown',
                typeIsText: ct === 'Unknown',
                typeStyle: 'background:' + tc[0] + ';color:' + tc[1] + ';',
                cardCls: 'ss-card' + (on ? ' ss-card-on' : ''),
                cardStyle: 'border-left-color:' + tc[2] + ';',
                ceLabel: ce.label,
                ceStyle: 'background:' + ce.bg + ';color:' + ce.fg + ';',
                statusLabel: p.status || 'No Status',
                hasSender: !!sender,
                sender,
                campaign: p.ceCampaign || '',
                subject: latest.subject || '(no subject)',
                preview: preview(latest.body, 110),
                coordLabel: p.coordinatorName || 'No Project Coordinator',
                coordCls: 'ss-card-coord' + (p.coordinatorName ? '' : ' ss-card-coord-none'),
                hasMore: others.length > 0,
                moreLabel: (expanded ? '▾ ' : '▸ ') + moreLabel(others.length),
                expanded
            });
            if (expanded) {
                others.forEach((r, i) =>
                    items.push({
                        key: p.leadId + '-e' + i,
                        isChild: true,
                        leadId: p.leadId,
                        childDate: fmtDateTime(r.createdDate),
                        childSubject: r.subject || '(no subject)',
                        childPreview: preview(r.body, 90)
                    })
                );
            }
        });
    });
    return items;
}

/**
 * Card click (canvas pick): on the selected card with earlier replies -> toggle them; else select it and open them.
 * Returns the new { activeKey, collapsed }.
 */
export function pickCard(state, leadId, othersCount) {
    const collapsed = { ...(state.collapsed || {}) };
    if (state.activeKey === leadId && othersCount > 0) {
        collapsed[leadId] = !collapsed[leadId];
        return { activeKey: leadId, collapsed };
    }
    delete collapsed[leadId];
    return { activeKey: leadId, collapsed };
}
