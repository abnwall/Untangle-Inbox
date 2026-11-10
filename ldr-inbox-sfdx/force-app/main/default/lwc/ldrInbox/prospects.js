/**
 * Prospects tab (outbound) rules and scoring, ported from the canvas (prototype a111, prospectEval).
 * People to phone who have NOT asked for a call: price-range instant estimates and 3D configurator quote builders.
 * Display-only: nothing here writes to Salesforce.
 */

// Tunable defaults (the team has not set these yet).
export const PROSPECT_RULES = {
    strongMin: 3,
    studioMiles: 50,
    estHighEnd: 25000,
    repeatGapDays: 60,
    bigQuote: 60000,
    hugeQuote: 100000,
    midQuote: 40000,
    heavyQuotes: 5,
    burstQuotes: 3,
    burstDays: 3,
    returnedDays: 90
};

// Reps who prefer to follow up their own configurator submissions (Aziz, 2026-10-09). Matched on the rep SHOWN.
export const PROSPECT_SET_ASIDE = [
    'Ryan Tudor',
    'Nathan Homann',
    'Georges Lagasse',
    'Bill Leon',
    'Brad Burden',
    'Guy & Christine Gere',
    'Andy Cook',
    'Matt Tudor',
    'Shawn Mahoney'
];
export const PROSPECT_DEALERS = ['Formas South Florida'];

export const HIDE_LABELS = {
    staff: 'staff or internal test',
    junk: 'test records',
    optout: 'opted out',
    worked: 'already worked or closed out',
    coordinated: 'already with a coordinator',
    nophone: 'no usable phone number',
    setaside: 'with reps who follow up themselves',
    closed: 'closed out earlier'
};

const DAY = 86400000;
const WINDFALL_LETTER = { '1': 'A+', '2': 'A', '3': 'B', '4': null, '5': 'U' };

export function money(v) {
    return v >= 1000000 ? '$' + Math.round(v / 100000) / 10 + 'M' : '$' + Math.round(v / 1000) + 'k';
}

/** "1 A+ Lead" -> "A+", "4 C Lead" -> "C", "4 D Lead" -> "D", blank -> "". */
export function windfallLetter(grade) {
    const g = (grade || '').trim();
    if (!g) return '';
    const m = g.match(/^\d\s+([A-Z][+]?)/);
    if (m) return m[1];
    return WINDFALL_LETTER[g.charAt(0)] || '';
}

/** High end of an estimate range like "$15,400-$19,700" (0 when not a range). */
export function estimateHighEnd(amount) {
    const parts = (amount || '').split('-');
    return parseInt((parts[1] || '').replace(/[^0-9]/g, ''), 10) || 0;
}

const norm = (v) =>
    (v || '')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .trim();

/**
 * Staff, reps and test submissions (not prospects): NanaWall email domain or company, the person IS the rep who owns
 * the record, or a name on the set-aside list. (Every KBMax quote is created by one integration user, so the creator
 * can't be used.)
 */
export function isStaff(row) {
    const em = (row.email || '').toLowerCase();
    const co = (row.company || '').toLowerCase();
    if (/@nanawall\.com$/.test(em) || /nana\s?wall/.test(co)) return true;
    const toks = norm(row.name).split(/\s+/).filter(Boolean);
    const first = toks[0] || '';
    const last = toks[toks.length - 1] || '';
    const owner = norm(row.owner);
    if (first && last && toks.length > 1 && owner.indexOf(first) !== -1 && owner.indexOf(last) !== -1) return true;
    return PROSPECT_SET_ASIDE.some((n) => norm(n) === norm(row.name));
}

/**
 * Rules + scoring for one prospect row.
 * row.pr (estimates): { wf, nw, opt, hi, n, firstAt }; row.kb (configurator): { n30, n, max, latest, first, recCreated, opt }.
 * ctx: { repShown: string, nearest: {studio, miles} | null, now: ms }.
 * Returns { hidden (reason key or ''), pts, tier, chips [{text, kind}], why [{text, points}], hasPhone, phoneShown, telHref }.
 */
export function evaluateProspect(row, ctx) {
    const R = PROSPECT_RULES;
    const now = ctx.now || Date.now();
    const digits = (row.phone || '').replace(/\D/g, '');
    const usable = digits.length === 10 || (digits.length === 11 && digits.charAt(0) === '1');
    const last10 = digits.slice(-10);
    const out = {
        hidden: '',
        pts: 0,
        tier: 'else',
        chips: [],
        why: [],
        hasPhone: usable,
        phoneShown: usable ? '(' + last10.slice(0, 3) + ') ' + last10.slice(3, 6) + '-' + last10.slice(6) : row.phone || '',
        telHref: usable ? 'tel:+1' + last10 : ''
    };
    const junk =
        /^no@no\.com$/i.test(row.email || '') ||
        /@example\./i.test(row.email || '') ||
        last10 === '1234567890' ||
        (digits.length > 0 && /^(\d)\1+$/.test(digits)) ||
        (usable && last10.slice(3, 6) === '555');
    const status = row.leadStatus || '';
    const coordinated = !!row.coordinatorName;
    const optedOut = status === 'Do Not Contact' || (row.pr && row.pr.opt) || (row.kb && row.kb.opt);
    // ---- 1) hidden by rules (never shown in the list; counted in the footer)
    if (isStaff(row)) out.hidden = 'staff';
    else if (junk) out.hidden = 'junk';
    else if (optedOut) out.hidden = 'optout';
    else if (row.isEstimate) {
        if (status && status !== 'New') out.hidden = 'worked';
        else if (coordinated) out.hidden = 'coordinated';
        else if (!usable) out.hidden = 'nophone';
    } else {
        const shown = ctx.repShown || '';
        const setAside = shown.indexOf(' or ') === -1 && PROSPECT_SET_ASIDE.some((n) => norm(shown).indexOf(norm(n)) !== -1);
        const working = ['New', 'Working', ''].indexOf(status) !== -1 && coordinated;
        if (setAside) out.hidden = 'setaside';
        else if (working) out.hidden = 'coordinated';
        else if (['Wrong profile', 'Disqualified', 'Close - No Further Action', 'Bounced'].indexOf(status) !== -1) out.hidden = 'closed';
        else if (!usable) out.hidden = 'nophone';
    }
    if (out.hidden) return out;
    // ---- 2) signals and points
    const add = (text, kind, points, reason) => {
        out.chips.push({ text, kind });
        out.pts += points;
        out.why.push({ text: reason || text, points });
    };
    if (row.isEstimate) {
        const pr = row.pr || {};
        const nw = pr.nw ? ' · ' + money(pr.nw) : '';
        const nwWhy = pr.nw ? ' (net worth about ' + money(pr.nw) + ')' : '';
        if (pr.wf === 'A+') add('Windfall A+' + nw, 'hot', 3, 'Windfall grade A+' + nwWhy);
        else if (pr.wf === 'A') add('Windfall A' + nw, 'hot', 2, 'Windfall grade A' + nwWhy);
        else if (pr.wf === 'B') add('Windfall B' + nw, 'good', 1, 'Windfall grade B' + nwWhy);
        if (pr.n >= 2) {
            const gap = pr.firstAt ? Math.round((Date.parse(row.createdAt) - Date.parse(pr.firstAt)) / DAY) : 0;
            if (gap >= R.repeatGapDays) {
                add('Estimated again after ' + gap + ' days', 'hot', 2, 'Estimated again after a long gap (' + gap + ' days since their first estimate)');
            } else {
                add(pr.n + ' estimates', 'good', 1, 'Repeat estimator (' + pr.n + ' estimates)');
            }
        }
        const sr = ctx.nearest;
        // Near a studio still scores and shows under "Why this prospect", but isn't a flag on the card (Aqil, 2026-10-13).
        if (sr) {
            out.pts += 1;
            out.why.push({ text: 'Within ' + R.studioMiles + ' miles of the ' + sr.studio + ' studio (' + sr.miles + ' mi)', points: 1 });
        }
        if (pr.hi >= R.estHighEnd) {
            add('Up to $' + Math.round(pr.hi / 1000) + 'k', 'good', 1, 'Estimate tops out at $' + pr.hi.toLocaleString() + ' (at or above $' + R.estHighEnd.toLocaleString() + ')');
        }
        if (row.projectType === 'New Construction') out.chips.push({ text: 'New construction', kind: 'info' });
        if (row.customerType && row.customerType !== 'Homeowner' && row.customerType !== 'Unknown') out.chips.push({ text: row.customerType, kind: 'info' });
    } else {
        const k = row.kb || {};
        const span = (Date.parse(k.latest) - Date.parse(k.first)) / DAY;
        const recDays = (now - Date.parse(k.recCreated)) / DAY;
        const n30 = k.n30 || 0;
        if (k.max >= R.hugeQuote) add('Large quote · ' + money(k.max), 'hot', 3, 'Large quote (' + money(k.max) + ', at or above ' + money(R.hugeQuote) + ')');
        else if (k.max >= R.bigQuote) add('Quote · ' + money(k.max), 'hot', 2, 'Big quote (' + money(k.max) + ', at or above ' + money(R.bigQuote) + ')');
        else if (k.max >= R.midQuote) add('Quote · ' + money(k.max), 'good', 1, 'Solid quote (' + money(k.max) + ', at or above ' + money(R.midQuote) + ')');
        if (n30 >= R.heavyQuotes) add(n30 + ' quotes in 30 days', 'good', 1, n30 + ' quotes in the last 30 days');
        else if (n30 >= R.burstQuotes && span <= R.burstDays) {
            const spanText = span < 1 ? 'a day' : Math.ceil(span) + ' days';
            add(n30 + ' quotes in ' + spanText, 'good', 1, 'A burst: ' + n30 + ' quotes within ' + spanText);
        }
        const worked = ['Nurture', 'Unreachable'].indexOf(status) !== -1 && coordinated;
        if (recDays >= R.returnedDays && worked) {
            const age = recDays >= 700 ? Math.round(recDays / 365) + ' years' : Math.round(recDays / 30) + ' months';
            add(
                'Returned · worked by ' + row.coordinatorName.split(' ')[0],
                'hot',
                3,
                'Came back after being worked (the record is ' + age + ' old, status ' + status + ', last coordinator ' + row.coordinatorName + ')'
            );
        } else if (recDays >= R.returnedDays) {
            out.chips.push({ text: 'Existing record · ' + new Date(k.recCreated).getUTCFullYear(), kind: 'info' });
        }
        if (row.customerType && row.customerType !== 'Unknown') out.chips.push({ text: row.customerType, kind: 'info' });
        if (PROSPECT_DEALERS.indexOf(row.owner) !== -1) out.chips.push({ text: 'Dealer-owned', kind: 'warn' });
        // Design files on their latest quote (canvas dd24): a drawing package, else IFC, else a Revit file.
        if (k.hasDrawing) out.chips.push({ text: 'Drawing package', kind: 'info' });
        if (k.hasIfc) out.chips.push({ text: 'IFC', kind: 'info' });
        else if (k.hasRevit) out.chips.push({ text: 'Revit file', kind: 'info' });
    }
    out.tier = out.pts >= R.strongMin ? 'strong' : out.pts >= 1 ? 'worth' : 'else';
    return out;
}

export const TIER_LABEL = { strong: 'Strong', worth: 'Worth a look', else: 'Everything else' };
export const TIER_CLASS = { strong: 'ldr-tier-strong', worth: 'ldr-tier-worth', else: 'ldr-tier-else' };
export const CHIP_CLASS = { hot: 'ldr-chip ldr-chip-hot', good: 'ldr-chip ldr-chip-good', info: 'ldr-chip ldr-chip-info', warn: 'ldr-chip ldr-chip-warn' };
