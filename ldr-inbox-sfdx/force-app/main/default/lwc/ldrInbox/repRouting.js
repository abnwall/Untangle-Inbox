/**
 * Rep display routing for the LDR Inbox (ported from the LDRInbox prototype, version 1791569913-7c73).
 *
 * Decides which rep name to DISPLAY, which can differ from the Salesforce owner. It only changes what the
 * inbox shows; it never reads or writes ownership in Salesforce.
 *
 * Order (canvas 7c73, split territories per Aqil 2026-10-08):
 * 1. Owner is not a split-territory rep: owner alias table, else the owner (canonical spelling).
 * 2. Owner is a split-territory rep and the Lead/Contact Territory__c is one of the split territories: that split,
 *    then residential / commercial (Southern California: residential ZIP list, commercial by county).
 * 3. Split rep with a Territory__c that isn't a split territory: the owner.
 * 4. Territory__c blank: the split the owner belongs to; if the owner is in two or more splits, the ZIP prefix, else
 *    the State, decides between them, else the owner (flagged).
 * Residential vs commercial: see projectType() (canvas #118 order: estimate, Homeowner, configurator Project Type, Lead
 * Project Type, Project Application Industry, form Application). Anything resting on a guess is flagged.
 *
 * Maintenance: when routing changes, edit the tables here (or move them to Custom Metadata later).
 */

/** Owners who are never displayed; the alias is shown instead. */
const OWNER_ALIASES = {
    'Stuart Ferrell': 'Julie Barnes',
    'Nick Wnenk': 'Gro Gabor',
    'Bryan Bush': 'Cameron Wiese'
};

/** Split territories (Aqil, 2026-10-08), matched on Territory__c. Owner names are the Salesforce User names. */
const SPLIT_GROUPS = [
    { key: 'CT', label: 'CT', territories: ['CT-metro', 'CT-west'], owners: ['Preferred Marketing', 'Jeff Calabrese', 'Guy & Christine Gere'], residential: 'Jeff Calabrese', commercial: 'Guy & Christine Gere' },
    // KS / MO and TX residential: Shawn Mahoney (Aqil, 2026-11-04; was April Lele’a, who is still the owner in Territory Master)
    { key: 'KSMO', label: 'KS / MO', territories: ['MO-KS-SouthIL Area'], owners: ['April Lele’a', 'Shawn Mahoney', 'Nathan Homann'], residential: 'Shawn Mahoney', commercial: 'Nathan Homann' },
    // NorCal (Aqil, 2026-11-04): from the owner alone (no territory yet), whatever Territory__c says
    { key: 'NORCAL', label: 'NorCal', territories: [], ownerOnly: true, owners: ['Brad Burden'], residential: 'Kris Trevino', commercial: 'Brad Burden' },
    { key: 'NY', label: 'Upstate NY', territories: ['NY-east-MJD', 'NY-misc-MJD', 'NY-north-metro-MJD'], owners: ['Preferred Marketing', 'Jeff Calabrese', 'Phil Blair'], residential: 'Jeff Calabrese', commercial: 'Phil Blair' },
    { key: 'PA', label: 'PA', territories: ['E. Pennsylvania', 'S. New Jersey', 'VA-MD-DE-WV-DC'], owners: ['Joe Bennett', 'Gunner Roberts'], residential: 'Joe Bennett', commercial: 'Gunner Roberts' },
    { key: 'SOCAL', label: 'Southern California', territories: ['CaSouth-LA', 'CaSouth-NorthCentral', 'CaSouth-SanDiego', 'CaSouth-upperLA-SanFernando'], owners: ['Joe Rapolla', 'Roozbeh Ahdoot', 'Shawn Mahoney', 'Jonathan Guerra', 'Andrew Scott'], socal: true },
    { key: 'TX', label: 'TX', territories: ['OK-TX Area'], owners: ['April Lele’a', 'Shawn Mahoney', 'Harmen Bollen'], residential: 'Shawn Mahoney', commercial: 'Harmen Bollen' }
];

/**
 * Split owners shown as someone else whenever the routing above would otherwise show the owner (a territory that isn't
 * a split, or a blank territory the ZIP / State can't settle). April Lele’a's accounts are Shawn Mahoney's (Aqil, 2026-11-04)
 * until Territory Master is updated; Preferred Marketing is Jeff Calabrese; the User "Andrew Scott" goes by Drew Scott.
 */
const SPLIT_OWNER_ALIASES = {
    'April Lele’a': 'Shawn Mahoney',
    'Preferred Marketing': 'Jeff Calabrese',
    'Andrew Scott': 'Drew Scott'
};

/** Southern California residential zips that go to Roozbeh Ahdoot (everything else in SoCal residential: Joe Rapolla). */
const SOCAL_RESIDENTIAL_ZIPS = new Set([
    '90272', '90049', '90077', '90210', '90024', '90048', '90069', '90046', '90036', '90005', '90035', '90095',
    '90073', '90067', '90211', '90212', '90402', '90025', '90064', '90019', '90403', '90404', '90034', '90401',
    '90405', '90066', '90291', '90292'
]);

// Residential vs commercial values (canvas #117 / #118, Aqil's rules 2026-10-19): the values the website forms, the
// 3D configurator (KBMax_Web_Quote__c.Type_of_record__c) and Lead.Type_of_record__c use.
const RES_TYPES = ['Residential', 'Patio', 'Dining Room', 'Living Room', 'Pool House', 'Bed / Bath'];
const COM_TYPES = ['Commercial', 'Restaurants', 'Educational', 'Retail', 'Office', 'Other'];

/** One value (configurator / Lead Project Type): blank -> null; residential value -> residential; anything else -> commercial. */
export function classifySingleType(v) {
    const t = (v || '').trim();
    if (!t) return null;
    return RES_TYPES.includes(t) ? 'residential' : 'commercial';
}

/**
 * Form Application (comma-separated): blank -> null; a value on neither list -> null; residential values (alone or with
 * "Other") -> residential; no residential values (commercial only, incl. "Other" alone) -> commercial; residential plus
 * a commercial value other than "Other" -> null.
 */
export function classifyApplication(app) {
    const apps = (app || '').split(',').map((x) => x.trim()).filter(Boolean);
    if (!apps.length) return null;
    const res = apps.filter((x) => RES_TYPES.includes(x));
    const com = apps.filter((x) => COM_TYPES.includes(x));
    if (res.length + com.length < apps.length) return null;
    if (res.length && com.every((x) => x === 'Other')) return 'residential';
    if (!res.length) return 'commercial';
    return null;
}

function normalize(s) {
    return (s || '')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[‘’`]/g, "'")
        .toLowerCase()
        .trim();
}

function sameName(a, b) {
    return normalize(a) === normalize(b);
}

/** "90001-90008, 90010" -> Set of 5-digit ZIPs. */
function expandZips(text) {
    const out = new Set();
    text.split(/[,\s]+/)
        .filter(Boolean)
        .forEach((p) => {
            const r = p.split('-');
            const a = parseInt(r[0], 10);
            const b = parseInt(r[1] || r[0], 10);
            for (let z = a; z <= b; z++) out.add(String(z).padStart(5, '0'));
        });
    return out;
}

// Southern California commercial (Aqil, 2026-10-12; canvas 9fed): Jonathan Guerra 363 ZIPs (Los Angeles 287,
// San Bernardino 76), Drew Scott 253 ZIPs (San Diego 96, Orange 89, Riverside 68). Any other ZIP: Shawn Mahoney.
const SOCAL_COMMERCIAL_JONATHAN = expandZips('90001-90008, 90010-90029, 90031-90049, 90056-90059, 90061-90069, 90071, 90077, 90079, 90094, 90134, 90201, 90210-90212, 90220-90222, 90230, 90232, 90240-90242, 90245, 90247-90250, 90254-90255, 90260-90262, 90265-90266, 90270, 90272, 90274-90275, 90277-90278, 90280, 90290-90293, 90301-90305, 90311, 90401-90405, 90501-90506, 90601-90606, 90638, 90640, 90650, 90660, 90670, 90701, 90703, 90706, 90710, 90712-90713, 90715-90717, 90723, 90731-90732, 90744-90746, 90755, 90802-90808, 90810, 90813-90815, 90822, 90831, 90833, 91001, 91006-91008, 91010-91011, 91016, 91020, 91024, 91030, 91040, 91042, 91101, 91103-91108, 91201-91208, 91210, 91214, 91301-91304, 91306-91307, 91311, 91316, 91321, 91324-91326, 91331, 91335, 91340, 91342-91345, 91350-91352, 91354-91356, 91364, 91367, 91381-91384, 91387, 91390, 91401-91403, 91405-91406, 91411, 91423, 91436, 91501-91502, 91504-91506, 91601-91602, 91604-91608, 91702, 91706, 91711, 91722-91724, 91731-91733, 91740-91741, 91744-91746, 91748, 91750, 91754-91755, 91765-91768, 91770, 91773, 91775-91776, 91780, 91789-91792, 91801, 91803-91804, 93510, 93532, 93534-93536, 93543-93544, 93550-93553, 93563, 93591, 91701, 91708-91710, 91730, 91737, 91739, 91758, 91761-91764, 91784, 91786, 92242, 92252, 92256, 92277, 92280, 92284-92285, 92301, 92305, 92307-92311, 92313-92316, 92318, 92323-92324, 92327, 92332, 92335-92339, 92342, 92344-92347, 92354, 92356, 92358-92359, 92363-92366, 92368, 92371-92374, 92376-92377, 92392, 92394-92395, 92397, 92399, 92401, 92403-92405, 92407-92408, 92410-92411, 93562');
const SOCAL_COMMERCIAL_DREW = expandZips('91901-91902, 91905-91906, 91910-91911, 91913-91917, 91932, 91934-91935, 91941-91942, 91945, 91950, 91962-91963, 91977-91978, 91980, 92003-92004, 92007-92011, 92014, 92019-92021, 92024-92029, 92036-92037, 92040, 92054, 92056-92059, 92061, 92064-92066, 92069-92071, 92075, 92078, 92081-92084, 92086, 92091, 92101-92111, 92113-92124, 92126-92131, 92139, 92154, 92173, 92199, 90620-90621, 90623, 90630-90631, 90680, 90720, 90740, 92602-92604, 92606, 92610, 92612, 92614, 92617-92618, 92620, 92624-92627, 92629-92630, 92637, 92646-92649, 92651, 92653, 92655-92657, 92660-92663, 92672-92673, 92675-92677, 92679, 92683, 92688, 92691-92692, 92694, 92701, 92703-92708, 92780, 92782, 92799, 92801-92802, 92804-92809, 92821, 92823, 92831-92833, 92835, 92840-92841, 92843-92845, 92861-92862, 92865-92870, 92886-92887, 92899, 91752, 92201, 92203, 92210-92211, 92220, 92223, 92225, 92230, 92234, 92236, 92240-92241, 92253-92254, 92260, 92262, 92264, 92270, 92274, 92276, 92282, 92320, 92501, 92503-92509, 92518, 92530, 92532, 92536, 92539, 92543-92545, 92548, 92551, 92553, 92555, 92557, 92561-92563, 92567, 92570-92571, 92582-92587, 92590-92592, 92595-92596, 92860, 92878-92883');

/**
 * 'residential' | 'commercial' | null (canvas #118). The first rule that decides wins:
 * 1. instant estimate -> residential; 2. Customer Type Homeowner (form / Lead Type__c / Contact LeadType__c) ->
 * residential; 3. 3D configurator -> the quote's Project Type; 4. Lead Project Type (Type_of_record__c);
 * 5. Project Application Industry; 6. the form's Application; else null (unable to determine).
 */
export function projectType(input) {
    if (input.isEstimate) return 'residential';
    const types = [input.customerType].concat(input.customerTypes || []);
    if (types.includes('Homeowner')) return 'residential';
    if (input.isConfigurator) {
        const k = classifySingleType(input.kbProjectType);
        if (k) return k;
    }
    const t = classifySingleType(input.typeOfRecord);
    if (t) return t;
    const ind = input.appIndustry || '';
    if (/^(single family|multifamily|common area)/i.test(ind)) return 'residential';
    if (ind && ind !== 'Mixed Use' && ind !== 'Other') return 'commercial';
    return classifyApplication(input.application);
}

/** States (full name or code, any case) that pick a split when an owner of several has a blank Territory__c. */
const SPLIT_STATES = {
    TX: ['texas', 'oklahoma', 'tx', 'ok'],
    KSMO: ['missouri', 'kansas', 'illinois', 'mo', 'ks', 'il'],
    CT: ['connecticut', 'ct'],
    NY: ['new york', 'ny'],
    SOCAL: ['california', 'ca'] // Shawn Mahoney owns SoCal, KS / MO and TX (v6f5)
};

/** ZIP prefixes (first 3 digits) for the same areas, checked first: the State isn't always filled in (v6f7). */
const SPLIT_ZIP3 = {
    TX: (p) => p === 730 || p === 731 || (p >= 733 && p <= 799) || p === 885,
    KSMO: (p) => (p >= 620 && p <= 658) || (p >= 660 && p <= 679),
    CT: (p) => p >= 60 && p <= 69,
    NY: (p) => p === 5 || (p >= 100 && p <= 149),
    SOCAL: (p) => p >= 900 && p <= 935
};

/** Choose between an owner's candidate splits from the ZIP, else the State (only when Territory__c is blank). */
function splitFromLocation(input, cands) {
    const z = (input.zip || '').trim();
    const p3 = /^\d{5}/.test(z) ? parseInt(z.slice(0, 3), 10) : NaN;
    const st = normalize(input.state);
    return (
        (Number.isNaN(p3) ? null : cands.find((g) => SPLIT_ZIP3[g.key] && SPLIT_ZIP3[g.key](p3))) ||
        cands.find((g) => (SPLIT_STATES[g.key] || []).includes(st)) ||
        null
    );
}

/** Owner alias only, no split-territory routing (Post Quote Rep and Split Territory flag, canvas #141 / #142). */
export function aliasOwner(name) {
    const n = (name || '').trim();
    if (!n) return '';
    const alias = Object.keys(OWNER_ALIASES).find((k) => sameName(k, n));
    return alias ? OWNER_ALIASES[alias] : n;
}

/**
 * @param {{owner: string, territory: string, state: string, zip: string, customerType: string,
 *          typeOfRecord: string, appIndustry: string, application: string}} input
 * @returns {{name: string, rule: string, flagged: boolean, note: string}} name '' means not determinable.
 */
export function resolveRepDisplay(input) {
    const owner = input.owner || '';
    const territory = (input.territory || '').trim();
    const isSplitOwner = SPLIT_GROUPS.some((g) => g.owners.some((o) => sameName(o, owner)));
    if (!isSplitOwner) {
        const alias = Object.keys(OWNER_ALIASES).find((k) => sameName(k, owner));
        if (alias) {
            return { name: OWNER_ALIASES[alias], rule: 'Owner alias', flagged: false, note: 'Owner ' + owner + ' is never displayed; substituted per the alias table.' };
        }
        return { name: owner, rule: 'Owner (not a split-territory rep)', flagged: false, note: '' };
    }
    const ptype = projectType(input);
    // The split's residential and commercial rep (SoCal: by ZIP), then the one for this project type; both when undetermined
    const pick = (g) => {
        let res = g.residential;
        let com = g.commercial;
        let resWhy = '';
        let comWhy = '';
        if (g.socal) {
            const z = (input.zip || '').trim().slice(0, 5);
            const roozbeh = SOCAL_RESIDENTIAL_ZIPS.has(z);
            res = roozbeh ? 'Roozbeh Ahdoot' : 'Joe Rapolla';
            resWhy = roozbeh ? ', ZIP ' + z + ' is on the Roozbeh Ahdoot list' : ', ZIP not on the Roozbeh Ahdoot list';
            com = SOCAL_COMMERCIAL_JONATHAN.has(z) ? 'Jonathan Guerra' : SOCAL_COMMERCIAL_DREW.has(z) ? 'Drew Scott' : 'Shawn Mahoney';
            comWhy = com === 'Shawn Mahoney' ? ', ZIP not on the Jonathan Guerra / Drew Scott lists' : ', ZIP ' + z + ' is on the ' + com + ' list';
        }
        if (ptype === 'residential') return { name: res, how: 'residential' + resWhy, undetermined: false };
        if (ptype === 'commercial') return { name: com, how: 'commercial' + comWhy, undetermined: false };
        // #153 B; v6g7 (Aqil): first names only, "Kris or Brad" (was "Kris Trevino Residential or Brad Burden Commercial")
        const first = (n) => String(n || '').trim().split(/\s+/)[0];
        return { name: first(res) + ' or ' + first(com), how: 'unable to determine project type: residential ' + res + ' / commercial ' + com, undetermined: true };
    };
    // The owner's name where the split rules fall back to it
    const ownerShown = () => {
        const a = Object.keys(SPLIT_OWNER_ALIASES).find((k) => sameName(k, owner));
        return a ? SPLIT_OWNER_ALIASES[a] : owner;
    };
    // 0. Owner-only splits (NorCal): the owner decides, whatever the territory. Worded "Split territory …" so the rep
    //    note shows "(NorCal Residential)" etc. (v6f6; v6f5's wording left it without a note)
    const byOwner = SPLIT_GROUPS.find((x) => x.ownerOnly && x.owners.some((o) => sameName(o, owner)));
    if (byOwner) {
        const r = pick(byOwner);
        return { name: r.name, rule: 'Split territory ' + byOwner.label + ' (owner ' + owner + '), ' + r.how, flagged: r.undetermined, note: '' };
    }
    // 1. Territory name
    const g = territory ? SPLIT_GROUPS.find((x) => x.territories.some((t) => sameName(t, territory))) : null;
    if (g) {
        const r = pick(g);
        return { name: r.name, rule: 'Split territory ' + g.label + ' (' + territory + '), ' + r.how, flagged: r.undetermined, note: '' };
    }
    if (territory) {
        return { name: ownerShown(), rule: 'Owner (territory ' + territory + ' is not a split territory)', flagged: false, note: '' };
    }
    // 2. Territory blank: the owner's split(s)
    const cands = SPLIT_GROUPS.filter((x) => x.owners.some((o) => sameName(o, owner)));
    if (cands.length === 1) {
        const r = pick(cands[0]);
        return {
            name: r.name,
            rule: 'Split territory ' + cands[0].label + ' (Territory blank, from owner ' + owner + '), ' + r.how,
            flagged: true,
            note: 'Territory is blank; the split was taken from the owner.'
        };
    }
    const loc = splitFromLocation(input, cands);
    if (loc) {
        const r = pick(loc);
        return {
            name: r.name,
            rule: 'Split territory ' + loc.label + ' (Territory blank, from owner + location), ' + r.how,
            flagged: true,
            note: 'Territory is blank; the split was taken from the owner and the ZIP / state.'
        };
    }
    return {
        name: ownerShown(),
        rule: 'Owner (Territory blank, and the location does not say which of ' + cands.map((x) => x.label).join(' / ') + ')',
        flagged: true,
        note: 'Set the Territory to route this correctly.'
    };
}

/** Short area names for the rep note (canvas #152 C). */
const NOTE_AREAS = { CT: 'CT', 'KS / MO': 'KS/MO', 'Upstate NY': 'Upstate NY', PA: 'PA', 'Southern California': 'SoCal', TX: 'TX', NorCal: 'NorCal' };

/**
 * The note shown after "Rep: <name>" on the record pages (canvas #152 C / #153 B), from a resolveRepDisplay result:
 * - owner alias -> "(Owner: <owner>)"
 * - split territory -> "(<Area> Residential)" / "(<Area> Commercial)"; project type undetermined -> undetermined = true
 *   and text "<Area> Res/Com Split)", shown after an italic "(Undetermined "
 * - Territory blank and the location can't choose between the owner's splits -> "(Owner <name> - Confirm if split)"
 * - a plain owner (incl. a split rep whose Territory isn't a split territory) -> no note.
 * @returns {{text: string, undetermined: boolean}}
 */
export function repNoteFor(route, owner) {
    const rule = (route && route.rule) || '';
    if (rule === 'Owner alias') return { text: '(Owner: ' + (owner || '') + ')', undetermined: false };
    if (rule.startsWith('Split territory ')) {
        const lab = Object.keys(NOTE_AREAS).find((k) => rule.startsWith('Split territory ' + k + ' ('));
        const area = lab ? NOTE_AREAS[lab] : '';
        const app = /, residential/.test(rule) ? 'Residential' : /, commercial/.test(rule) ? 'Commercial' : '';
        // v6g7 (Aqil): "(Undetermined Res/Com Split)", without the area
        if (!app) return { text: 'Res/Com Split)', undetermined: true };
        return { text: '(' + [area, app].filter(Boolean).join(' ') + ')', undetermined: false };
    }
    if (rule.startsWith('Owner (Territory blank, and the location does not say which of ')) {
        return { text: '(Owner ' + ((route && route.name) || owner || '') + ' - Confirm if split)', undetermined: false };
    }
    return { text: '', undetermined: false };
}
