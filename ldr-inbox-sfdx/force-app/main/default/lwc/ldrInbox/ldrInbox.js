import { LightningElement, api, wire } from 'lwc';
import { getObjectInfo, getPicklistValuesByRecordType } from 'lightning/uiObjectInfoApi';
import LEAD_OBJECT from '@salesforce/schema/Lead';
import { NavigationMixin } from 'lightning/navigation';
import { IsConsoleNavigation, openTab } from 'lightning/platformWorkspaceApi';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import { loadStyle } from 'lightning/platformResourceLoader';
import NANAWALL_FONTS from '@salesforce/resourceUrl/NanaWallFonts';
import BASE_STYLES from '@salesforce/resourceUrl/LDR_InboxBaseStyles';
import getQueue from '@salesforce/apex/LdrInboxController.getQueue';
import getRelated from '@salesforce/apex/LdrInboxController.getRelated';
import getAccountSummary from '@salesforce/apex/LdrInboxController.getAccountSummary';
import getPersonSubmissions from '@salesforce/apex/LdrInboxController.getPersonSubmissions';
import claimApex from '@salesforce/apex/LdrInboxController.claim';
import releaseApex from '@salesforce/apex/LdrInboxController.release';
import saveLeadFields from '@salesforce/apex/LdrInboxController.saveLeadFields';
import handoffApex from '@salesforce/apex/LdrInboxController.handoff';
import logCallApex from '@salesforce/apex/LdrInboxController.logCall';
import assignToCoordinatorApex from '@salesforce/apex/LdrInboxController.assignToCoordinator';
import getLeadTimeline from '@salesforce/apex/LdrInboxController.getLeadTimeline';
import getClaimContext from '@salesforce/apex/LdrInboxController.getClaimContext';
import getContactOpportunities from '@salesforce/apex/LdrInboxController.getContactOpportunities';
import saveStatusWithoutClaim from '@salesforce/apex/LdrInboxController.saveStatusWithoutClaim';
import reassignApex from '@salesforce/apex/LdrInboxController.reassign';
import claimFromApex from '@salesforce/apex/LdrInboxController.claimFrom';
import createLeadApex from '@salesforce/apex/LdrInboxController.createLeadForSubmission';
import saveSixSenseApex from '@salesforce/apex/LdrInboxController.saveSixSense';
import getLinkSuggestionsApex from '@salesforce/apex/LdrInboxController.getLinkSuggestions';
import linkSubmissionApex from '@salesforce/apex/LdrInboxController.linkSubmission';
import searchLinkRecordsApex from '@salesforce/apex/LdrInboxController.searchLinkRecords';
import { notifyRecordUpdateAvailable } from 'lightning/uiRecordApi';
import getProspectsApex from '@salesforce/apex/LdrInboxController.getProspects';
import getConfiguratorDetailApex from '@salesforce/apex/LdrInboxController.getConfiguratorDetail';
import fixLinksApex from '@salesforce/apex/LdrInboxController.fixLinks';
import markFixReviewedApex from '@salesforce/apex/LdrInboxController.markFixReviewed';
import markFixesReviewedApex from '@salesforce/apex/LdrInboxController.markFixesReviewed';
import getAllSubmissionsApex from '@salesforce/apex/LdrInboxController.getAllSubmissions';
import getLeadConversionApex from '@salesforce/apex/LdrInboxController.getLeadConversion';
import qualifyConvertedContactApex from '@salesforce/apex/LdrInboxController.qualifyConvertedContact';
import markJunkApex from '@salesforce/apex/LdrInboxController.markJunk';
import restoreJunkApex from '@salesforce/apex/LdrInboxController.restoreJunk';
import getPostQuoteApex from '@salesforce/apex/LdrInboxController.getPostQuote';
import searchPeopleApex from '@salesforce/apex/LdrInboxController.searchPeople';
import getUncontactedClaimsApex from '@salesforce/apex/LdrInboxController.getUncontactedClaims';
import getSixSenseRepliesApex from '@salesforce/apex/LdrInboxController.getSixSenseReplies';
import moveLegacyFieldsApex from '@salesforce/apex/LdrInboxController.moveLegacyFields';
import markNoContactNeededApex from '@salesforce/apex/LdrInboxController.markNoContactNeeded';
import setUnlinkedStatusApex from '@salesforce/apex/LdrInboxController.setUnlinkedStatus';
import { resolveRepDisplay, aliasOwner, repNoteFor } from './repRouting';
import { evaluateProspect, windfallLetter, estimateHighEnd, money as shortMoney, HIDE_LABELS, TIER_LABEL, TIER_CLASS, CHIP_CLASS } from './prospects';

// Unclaimed · Mine · Finished on the left, Team on the right (prototype 1791332457-946d).
// Canvas a111: Unclaimed · Mine · Post Quote (every LDR since #139) · Prospects on the left; Finished · All on the right.
// v5 (#151 / #152 A): 6Sense right of Mine, for the admins only (as themselves or in Boss View; not while viewing as
// another LDR). Its list and page are the ldrSixSense component.
const TABS = [
    { key: 'unclaimed', label: 'Unclaimed', right: false },
    { key: 'mine', label: 'Mine', right: false },
    { key: 'sixsense', label: '6Sense', right: false, adminOnly: true },
    { key: 'postquote', label: 'Post Quote', right: false },
    { key: 'prospects', label: 'Prospects', right: false },
    { key: 'finished', label: 'Finished', right: true },
    // "All" (was "Team"): every claimed submission still being worked, including your own (canvas c90e).
    { key: 'team', label: 'All', right: true }
];
// canvas #143: tab names for "In <Tab>" / "Go to <Tab> Tab"; the cross-tab sort order; a record's own tab, first match
const TAB_LABEL = Object.fromEntries(TABS.map((t) => [t.key, t.label]));
const XT_ORDER = ['unclaimed', 'mine', 'sixsense', 'postquote', 'prospects', 'finished', 'team'];
const XT_HOME_TABS = ['unclaimed', 'mine', 'prospects', 'finished', 'team'];
const XT_CAP = 8;
// canvas #156: the tabs whose cards are dated and sorted by claim time
const CLAIM_DATED_TABS = ['mine', 'finished', 'team'];
// canvas #156: an automation tag in the old place (form Comments__c, estimate Questions_or_Comments__c)
const OLD_TAG_RE = /#(LinkFixed|FixReviewed|JunkUndone|NoContactNeeded|Junk:)/;
// canvas #148: the tabs with a "Search name or email…" box
const SEARCH_TABS = ['prospects', 'postquote'];
// canvas #144: a full email address -> exact match; anything else -> partial (SOSL)
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CONFIGURATOR = '3D Configurator';
const LINK_FIXED_TAG = '#LinkFixed';
const FIX_REVIEWED_TAG = '#FixReviewed';
const PROSPECT_WORTH_CAP = 10;
const CFG_QUOTES_SHOWN = 5;
const BOSS_TABS = [
    { key: 'inbox', label: 'LDR Inbox' },
    { key: 'allsubs', label: 'All Submissions' },
    { key: 'dash', label: 'Dashboard' },
    { key: 'audit', label: 'Claim Audit' }, // canvas #145B
    { key: 'six', label: '6Sense Dashboard' }
];
const ALL_SUBS_PRESETS = [
    { key: '7', label: 'Past 7 days' },
    { key: '30', label: 'Past 30 days' },
    { key: '90', label: 'Past 90 days' },
    { key: '365', label: 'Past year' }
];
// Pacific yyyy-mm-dd, like todayPacific(). (toISOString() is UTC, which moved the All Submissions range a day ahead
// after ~5pm Pacific.)
const isoDay = (t) => new Date(t).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
// Junk submissions (canvas dd24): reasons, and the "#Junk:<reason>" tag the Apex writes to the Comments field (#156). On a row
// linked to a Lead / Contact (canvas d84b, #94) the tag also carries the record's previous values for Restore:
// "#Junk:<reason>{prev:<Status>|<Status Reason>|<Outcome>|<Lead Funnel Timestamp yyyy-mm-dd>|<Project Coordinator Id>}"
// (older marks have no coordinator slot).
const JUNK_REASONS = ['Solicitation or sales pitch', 'Fake or invalid contact info', 'Test submission', 'Not a customer (other)'];
// #153 D: the Lead Funnel Outcome each reason sets (same map as the Apex JUNK_OUTCOMES), for the toast.
const JUNK_OUTCOMES = {
    'Solicitation or sales pitch': 'Spam/Solicitation',
    'Fake or invalid contact info': 'Invalid Contact Information',
    'Test submission': 'Other',
    'Not a customer (other)': 'Other'
};
const JUNK_CUT = '\u0000';
/** True when the junk tag carries the linked record's previous values (Restore puts them back). */
function junkHasPrev(comments) {
    return /#Junk:[^{#]*\{prev:/.test(comments || '');
}
/** Today in Pacific time as yyyy-mm-dd (Lead Funnel Timestamp). */
function todayPacific() {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
}
/**
 * A claim time (ClaimedDate__c) in Pacific: "Oct 25, 2026, 2:56 PM". Claims from before the field existed were
 * backfilled to exactly midnight Pacific (#156), so those show the date only ("Oct 20, 2026"), like Claim Audit's
 * "date only".
 */
function claimTimeLabel(at) {
    const d = new Date(at);
    const pt = { timeZone: 'America/Los_Angeles' };
    const dateOnly = d.toLocaleTimeString('en-GB', pt) === '00:00:00';
    return d.toLocaleString('en-US', dateOnly
        ? { ...pt, month: 'short', day: 'numeric', year: 'numeric' }
        : { ...pt, month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}
/** The Pacific date n days before today, as yyyy-mm-dd (compares with Lead Funnel Timestamp strings). */
function daysAgoPacific(n) {
    const d = new Date(todayPacific() + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() - n);
    return d.toISOString().slice(0, 10);
}
// #152 D: "Project Coordinator is already …" (Unclaimed) shows only when Lead Funnel Timestamp is this recent (today incl.).
// v6g8 (Aqil): hidden when the timestamp is over 30 days ago (was 7).
const COORD_WARNING_DAYS = 30;
// #152 E: the "You took this over from …" reminder shows this long after the claim; × is kept per user in localStorage
// (pruned after a few days: the reminder has ended by then anyway).
const TOOK_OVER_HOURS = 24;
/** #160: Link to Existing's Advanced Search shows at most this many (LdrInboxController.LINK_SEARCH_MAX). */
const LINK_ADV_MAX = 50;
/** Attach to Opportunity: the newest open opportunity counts as the flow's new one when made this recently. */
const ATTACH_OPP_FRESH_MIN = 30;
const TOOK_OVER_KEEP_DAYS = 3;
const TOOK_OVER_STORE_PREFIX = 'ldrInbox.tookOverDismissed.';
// Status buttons in LDR fields (canvas d84b, #94B).
// #152 F: Qualified (between Disqualified and Junk) sets the status the same way; the record moves to Finished.
const QUICK_STATUSES = ['Working', 'Nurture', 'Unreachable', 'Disqualified', 'Qualified'];
// v6g7 (Aqil): before a Lead / Contact is linked, these three work too: "#<status>" in the tag field (Apex
// setUnlinkedStatus). Unreachable / Disqualified make it finished: Finished / All for FINISHED_DAYS from that click.
const UNLINKED_STATUSES = ['Working', 'Unreachable', 'Disqualified'];
const UNLINKED_DONE = ['Unreachable', 'Disqualified'];
/** The last "#Working" / "#Unreachable" / "#Disqualified" in the tags, or ''. */
function unlinkedStatusOf(tags) {
    const m = String(tags || '').match(/#(Working|Unreachable|Disqualified)\b/g);
    return m ? m[m.length - 1].slice(1) : '';
}
function junkReasonOf(comments) {
    const c = comments || '';
    return JUNK_REASONS.find((reason) => c.includes('#Junk:' + reason)) || '';
}
/**
 * Comments__c / Questions_or_Comments__c without the app's internal tags (#LinkFixed..., #FixReviewed,
 * #Junk:<reason>, #JunkUndone, #NoContactNeeded). One helper for everything the inbox shows or copies (detail, Related /
 * Other submissions, FETR copy, Draft email): mapRow strips the text once, and every view reads the stripped row.
 */
function stripFixTags(v) {
    if (typeof v !== 'string') return v;
    let out = v.replace(/\s*#(LinkFixed-email|LinkFixed-both|LinkFixed-converted|LinkFixed|FixReviewed|JunkUndone|NoContactNeeded|Working|Unreachable|Disqualified)\b/g, '');
    JUNK_REASONS.forEach((reason) => {
        out = out.split('#Junk:' + reason).join(JUNK_CUT);
    });
    // drop the "{prev:...}" block that may follow a junk tag, then the cut markers
    out = out.split(JUNK_CUT + '{prev:').map((part, i) => (i === 0 ? part : part.slice(part.indexOf('}') + 1))).join('');
    return out.split(JUNK_CUT).join('').trim();
}
/** Position_File_Ids__c ";Scene Render Front Open:1531858;Render Pass Top Open:1531861" -> [[label, id]]. */
function parsePositions(v) {
    return (v || '')
        .split(';')
        .map((x) => x.trim())
        .filter(Boolean)
        .map((x) => {
            const i = x.lastIndexOf(':');
            const label = (i > 0 ? x.slice(0, i) : x)
                .replace(/^Scene Render /i, '')
                .replace(/^Render Pass /i, '')
                .replace(/ (Open|Stacked)$/i, ' · $1')
                .toLowerCase()
                .replace(/^\w/, (c) => c.toUpperCase());
            return [label, i > 0 ? x.slice(i + 1) : ''];
        });
}
// "View as" entry that keeps you as yourself but lets you edit unclaimed records without claiming (admins only).
const BOSS_VIEW = '__boss';
// Admins who can always edit unclaimed records without Boss View (Aziz Nana).
const ALWAYS_EDIT_UNCLAIMED_IDS = ['005A0000000MOIwIAO'];
// Shown to the admins in the top bar; matches the ldr-inbox-updates-v<N> branch / v<N>-<date> tag of this build.
const APP_VERSION = 'v7';
// Related submissions card: show this many, "Load more" reveals the rest.
const RELATED_PAGE = 5;
const INSTANT_ESTIMATE = 'Instant Estimate';
const LUNCH_AND_LEARN = 'Lunch & Learn Request';
// Inquiry Type tag colours (Outlook flag palette, canvas c90e). CSS classes ldr-inq-*.
const INQUIRY_CLASS = {
    Quote: 'quote',
    Consultation: 'consultation',
    'Website Estimate': 'estimate',
    'Instant Estimate': 'estimate',
    '3D Configurator': 'configurator',
    'Contact Us': 'contactus',
    'Lunch & Learn Request': 'lunch',
    'Design Assistance': 'design',
    Representative: 'rep'
};

// Draft email: blank lines the copied details start with, so the LDR can write above them.
const EMAIL_TOP_BLANK_LINES = 4;
const MAIL_FONT = 'font-family:Aptos, Calibri, Arial, sans-serif; font-size:11pt;';
// Draft email template buttons (canvas aabc): Estimate Small / Large only on instant estimate rows.
const EMAIL_TEMPLATES = [
    { kind: 'request', label: 'Request Information', title: 'Add the Request Information message to the top of the email (click again to remove)' },
    { kind: 'estSmall', label: 'Estimate Small', estimateOnly: true, title: 'Opening smaller than the estimator covers (click again to remove)' },
    { kind: 'estLarge', label: 'Estimate Large', estimateOnly: true, title: 'Opening larger than the estimator covers (click again to remove)' },
    { kind: 'handoff', label: 'Handoff', title: 'Add the Handoff message to the top of the email (click again to remove)' }
];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/**
 * A Date field value ("2026-10-13", or Apex's "2026-10-13 00:00:00") -> "Oct 13, 2026"; blank or not a real date -> ''
 * (canvas #121: never "Invalid Date"). Reads the date part only, so there's no time-zone shift.
 */
function wfDateLabel(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    if (!m) return '';
    const mo = parseInt(m[2], 10);
    const dy = parseInt(m[3], 10);
    if (mo < 1 || mo > 12 || dy < 1 || dy > 31) return '';
    return MONTHS[mo - 1] + ' ' + dy + ', ' + m[1];
}

function esc(t) {
    return String(t === null || t === undefined ? '' : t)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// Draft-email message templates (canvas aabc, #96B / #97 / #98). Wording copied verbatim from the canvas'
// emailTemplateLines(). *word* = bold; a line starting "-\t" = dash bullet. The message replaces the blank lines at
// the top of the copied email; the design-studio line and the details table follow as before.
function emailTemplateLines(kind, first) {
  const intro = 'To best assist you, I\'d like to connect you with your local NanaWall representative who can help you evaluate system options, provide you with a quote/estimate, and advise on any questions or concerns you may have throughout your project.';
  if (kind === 'request') return [
    'Hi ' + (first || '[First Name]') + ',', '', 'Thank you for your interest in NanaWall!', '', intro, '',
    'Could you please provide me with the following to help us get a better understanding of your project and determine which representative would be best suited to help you:', '',
    '-\tThe *height* and *width* of the opening (or approximate)',
    '-\tAny *pictures* and/or *drawings* of the space',
    '-\tThe *name* & *application* of the project (residential/office/restaurant/school/etc.)',
    '-\tThe *location* (city, zip code) of the project',
    '-\tAny additional details, system preferences/requirements, performance needs, or questions/concerns you may have', '',
    'Looking forward to hearing from you and working with you on your project.', '', '', 'Best,', ''];
  // Instant estimate replies (#98): opening smaller / larger than the estimator covers.
  const estAsk = (approx) => ['I\u2019m more than happy to help if you\u2019d like a system recommendation and more precise quote for your project. To do so, could you please provide me with the following to help us get a better understanding of your project:', '',
    '-\tThe *height* and *width* of the opening' + (approx ? ' (or approximate)' : ''),
    '-\tAny *pictures* and/or *drawings* of the space',
    '-\tThe *name* & *application* of the project (residential/office/restaurant/school/etc.)',
    '-\tThe *location* (city, zip code) of the project',
    '-\tAny additional details, system preferences/requirements, performance needs, or questions/concerns you may have', '',
    'Looking forward to hearing from you and working with you on your project.', '', '', 'Best,', ''];
  if (kind === 'estSmall') return [
    'Hi ' + (first || '[Name]') + ',', '', 'Thank you for your interest in NanaWall!', '',
    'I see that you had used our instant estimator tool, but the size of your opening was smaller than the estimator can be used for (the smallest opening size that this tool can be used for is 6-9\u2019 wide x 7\' tall).', '',
    'For an opening of 6-9\' x 7\' the approximate cost would be $8,400-$13,800. It is worth noting that this is a rough estimate, so the actual cost could be lower or higher depending on the system used and your project requirements.', ''].concat(estAsk(false));
  if (kind === 'estLarge') return [
    'Hi ' + (first || '[Name]') + ',', '', 'Thank you for your interest in NanaWall!', '',
    'I see that you had used our instant estimator tool, but the size of your opening was larger than the estimator goes up to (the maximum opening size that this tool can be used for is 15-18\u2019 wide x 9\' tall).', '',
    'For an opening of 15-18\' x 9\' the approximate cost would be $25,700-$33,000. It is worth noting that this is a rough estimate, so the actual cost could be lower or higher depending on the system used and your project requirements.', ''].concat(estAsk(true));
  if (kind === 'handoff') return [
    // canvas #130: "Hi <First Name>," like Request Information (was "Hi,")
    'Hi ' + (first || '[First Name]') + ',', '', 'Thank you for your interest in NanaWall!', '', intro, '',
    'I\'ve forwarded your project details to them and asked that they reach out to you. For your future reference, or if you\u2019d like to contact them directly, I\'ve included their contact information below.', '',
    '*InsertRepInfo*', '', 'We look forward to working with you on your project!', '', '', 'Best,', ''];
  return [];
}

/** Template lines as Outlook HTML: one <p> per line (blank = &nbsp;), *word* bold, "-\t" lines as hanging-indent dashes. */
function emailTemplateHtml(lines) {
    const bold = (t) => esc(t).replace(/\*([^*]+)\*/g, '<b>$1</b>');
    return lines
        .map((ln) => {
            if (!ln) return '<p style="margin:0;' + MAIL_FONT + '">&nbsp;</p>';
            if (ln.indexOf('-\t') === 0) {
                return '<p style="margin:0 0 0 .5in; text-indent:-.25in;' + MAIL_FONT + '">-&nbsp;&nbsp;&nbsp;&nbsp;' + bold(ln.slice(2)) + '</p>';
            }
            return '<p style="margin:0;' + MAIL_FONT + '">' + bold(ln) + '</p>';
        })
        .join('');
}

/** Template lines as plain text (no asterisks). */
function emailTemplateText(lines) {
    return lines.map((ln) => ln.replace(/\*([^*]+)\*/g, '$1')).join('\n');
}

/** Template lines as the editable message (#152 H): "-\t" bullets become "- ", *bold* stays. */
function templateToMessage(lines) {
    return lines.map((ln) => (ln.indexOf('-\t') === 0 ? '- ' + ln.slice(2) : ln)).join('\n');
}

/** The edited message back as template lines: "- " lines are bullets again (copied as dash paragraphs). */
function messageToLines(text) {
    return String(text || '')
        .replace(/\r\n?/g, '\n')
        .split('\n')
        .map((ln) => (ln.indexOf('- ') === 0 ? '-\t' + ln.slice(2) : ln));
}

/**
 * Outlook-friendly HTML for the draft email body: the template message (or blank lines), extras (links), then the
 * details table. Canvas aabc (#96A / #98): table 90% wide, first column 1.67in, Aptos 10pt inside (the rest of the
 * email stays 11pt), no spacer row; a 1/4 pt solid line above the first row.
 */
function emailRichHtml(rows, extras, tpl) {
    let h = tpl && tpl.length ? emailTemplateHtml(tpl) : ('<p style="margin:0;' + MAIL_FONT + '">&nbsp;</p>').repeat(EMAIL_TOP_BLANK_LINES);
    extras.forEach((x) => {
        h += '<p style="margin:0 0 10px 0;' + MAIL_FONT + '">' + esc(x.before) + '<a href="' + esc(x.url) +
            '" style="color:#467886; text-decoration:underline;">' + esc(x.linkText) + '</a>' + esc(x.after) + '</p>';
    });
    const tfont = 'font-family:Aptos, Calibri, Arial, sans-serif; font-size:10pt;';
    h += '<table border="0" cellspacing="0" cellpadding="0" width="90%" style="border-collapse:collapse; width:90%;">';
    rows.forEach((r, i) => {
        const bt = i === 0 ? 'border-top:0.25pt solid #000000; ' : '';
        h += '<tr><td valign="top" width="160" style="width:1.67in; padding:2px 14px 2px 0; color:#6B7280; ' + bt + tfont + '">' + esc(r.k) +
            '</td><td valign="top" style="padding:2px 0; ' + bt + tfont + '">' + esc(r.v).replace(/\r?\n/g, '<br>') + '</td></tr>';
    });
    return h + '</table>';
}

/** Plain-text version: template (or blank lines), extras, then "Label:<tab>value" rows (no separator line, #96A). */
function emailRichText(rows, extras, tpl) {
    const lines = extras.map((x) => x.before + x.linkText + x.after + ' ' + x.url);
    return (tpl && tpl.length ? emailTemplateText(tpl) + '\n' : '\n'.repeat(EMAIL_TOP_BLANK_LINES)) + (lines.length ? lines.join('\n') + '\n\n' : '') +
        rows.map((r) => r.k + ':\t' + String(r.v === null || r.v === undefined ? '' : r.v).replace(/\r?\n/g, ' ')).join('\n');
}

/**
 * v5.7: the form's Project Timeline, Product Type and Application under the FETR comments, after a blank line; a blank
 * field gets no line, and nothing is added when all three are blank. Application is comma-separated on the form
 * ("Patio,Living Room"), so it gets a space after each comma.
 */
function fetrProjectLines(s) {
    const app = (s.Application__c || s.Project_Application__c || '').split(/\s*[,;]\s*/).filter(Boolean).join(', ');
    const lines = [
        ['Project Timeline', (s.Project_Timeline__c || '').trim()],
        ['Product Type', (s.Product_Type__c || '').trim()],
        ['Application', app]
    ].filter((x) => x[1]);
    return lines.length ? '\n\n' + lines.map((x) => x[0] + ': ' + x[1]).join('\n') : '';
}

/** FETR table as Outlook-ready HTML (inline styles from the team's FETR template). */
function fetrHtml(rows) {
    const td = 'padding:2px 5px 2px 3px; font-size:11pt; font-family:Aptos, Arial, sans-serif;';
    const body = rows
        .map((r) => {
            if (r.isHeader) {
                return '<tr><td style="' + td + 'background-color:' + r.bg + '; border-bottom:1px solid black;"><span style="font-size:' +
                    (r.dark ? '13pt' : '12pt') + '; font-weight:bold; color:' + r.fg + ';">' + esc(r.k) + '</span></td></tr>';
            }
            // canvas #122: Questions/Comments/Concerns and Home/Zip Code Value start on the line below the label
            return '<tr><td style="' + td + 'border-bottom:1px dotted black;"><b>' + esc(r.k) + '</b>:' + (r.below ? '<br>' : ' ') +
                (r.hasHref ? '<a href="' + esc(r.href) + '" style="color:#00798F; text-decoration:underline;">' + esc(r.v) + '</a>' : esc(r.v).replace(/\n/g, '<br>')) +
                '</td></tr>';
        })
        .join('');
    return '<p style="font-family:Aptos, Arial, sans-serif; font-size:11pt;">Hi Team,</p><p>&nbsp;</p><table style="border-collapse:collapse; width:600px;">' +
        body + '</table><p>&nbsp;</p><p style="font-family:Aptos, Arial, sans-serif; font-size:11pt;">Best,</p>';
}

/** v6g7 (Aqil): the form Types some submissions carry (seen in the sandbox), shown as the usual short tag. */
const FORM_ALIASES = { 'Virtual Consultation': 'Consultation', 'Quote Request': 'Quote' };
function formName(t) {
    return FORM_ALIASES[t] || t;
}

function inquiryCls(form) {
    return 'ldr-tag ldr-inq-' + (INQUIRY_CLASS[form] || 'other');
}

/**
 * Website_Instant_Estimate__c row -> the same shape as a Form_Submission__c row, so the queue, claim and detail
 * code treat both alike. Estimate-only values go in `estimate`.
 */
function normalizeEstimate(e) {
    return {
        ...e,
        isEstimate: true,
        Submit_Time__c: e.CreatedDate,
        Inquiry_Type__c: INSTANT_ESTIMATE,
        estimate: {
            number: e.Instant_Estimate_Number_ID__c || e.Name,
            amount: e.Estimate_Amount__c,
            frameType: e.Frame_Type__c,
            width: e.Frame_Width__c,
            height: e.Frame_Height__c,
            classification: e.Project_Classification__c,
            gate: e.Gate_Variant__c,
            sourceUrl: e.Source_URL__c
        }
    };
}

function estimatePreview(est) {
    if (!est) return '';
    const size = [est.width, est.height].filter(Boolean).join(' × ');
    const head = est.amount && est.amount !== 'Custom' ? est.amount : 'Custom estimate';
    return head + ' · ' + [est.frameType, size].filter(Boolean).join(' · ');
}
// Finished tab: claimed by you, status moved past New/Working (or Lead converted) within this many days (was 7; #149
// made it 30, Aqil then chose 14 on 2026-10-27). Same value as the Apex queue's FINISHED_DAYS.
const FINISHED_DAYS = 14;
// Post Quote replies marked done stay in Finished / All this many days (ldrPostQuote's DONE_DAYS; #149 kept it at 7).
const PQ_DONE_DAYS = 7;
// The dashboards' "Finished this week" (#149 left it at 7 days).
const WEEK_DAYS = 7;
// "No outreach" flag (Mine): more than this many days since the later of claim / set to Working / your last activity.
const NO_OUTREACH_DAYS = 5;
const DAY_MS = 86400000;
// Mine / Team keep a claimed submission only while it's still being worked: Lead.Status (or, for Contacts,
// Contact.Lead_Funnel_Status__c) is New or Working. Any other status takes it off the list.
const ACTIVE_STATUSES = ['New', 'Working'];
// Claiming a Lead/Contact in a stale or decided status resets it to New (Apex CLAIM_RESETS_STATUS = both lists).
// Stale statuses: the new submission is a re-engagement signal.
// Also stale: any status that isn't an active value of the field's picklist (e.g. Contact "Inactive", Lead "Close - No
// Further Action"); see isStaleStatus(). Apex resets those on claim too (2026-10-21).
const STALE_STATUSES = ['Nurture', 'Wrong profile', 'Unreachable', 'Bounced'];
// Decided statuses: also reset, because Mine/Team only show New/Working and the claimed lead would otherwise
// disappear from every tab. The inbox warns before the claim.
const DECIDED_STATUSES = ['Qualified', 'Disqualified'];
// Commercial Project Application Industry values (Lead.Project_Application_Industry__c under Type = Commercial),
// from the prototype's picklist dependency table. "Other" is never auto-picked.
const COMMERCIAL_INDUSTRIES = [
    'Automotive', 'Education', 'Health Care', 'Hotel', 'Mixed Use', 'Office', 'Recreation/Entertainment',
    'Religious Institution', 'Restaurant', 'Retail', 'Sports Venue'
];
// Banner keys an LDR can close with × (per submission, until they switch submission or tab). v5.7: on every tab (was
// Mine only), and the junk banner too.
const DISMISSABLE = [
    'conflict', 'convertedAfter', 'coordWarning', 'tookOver', 'assigned', 'notYetLinked', 'staleStatus',
    'decidedStatus', 'needsStatus', 'noOutreach', 'mismatch', 'junk'
];
// v6e record header: px between the name and the buttons, and between buttons (ldrInbox.css .ldr-d-hrow-top / v6 gap)
// v6g2: the popups' own close / cancel handlers, the only ones a click outside a popup may call (overlayClick)
const OVERLAY_CLOSERS = [
    'closeConvertFlow', 'closeAttachOpp', 'closeLinkDialog', 'closeLinkAdv', 'closeRelinkList', 'closeUncontacted', 'confirmNo',
    'closeActivityPreview', 'cancelQuickEdit', 'closeEmailPreview', 'cancelLogCall', 'cancelCreateLead', 'cancelProjectDetails'
];
const HEADER_NAME_GAP = 6;
const HEADER_BUTTON_GAP = 6;
// Project Details fields.
const PROJECT_DETAIL_FIELDS = [
    'Project_Name__c', 'Type_of_record__c', 'Project_Application_Industry__c', 'Project_Application__c',
    'Project_Site_Country__c', 'Project_Site_Street__c', 'Project_Site_City__c', 'Project_Site_State__c',
    'Project_Site_Zip_Code__c', 'Project_Construction_Classification__c', 'Project_Timeline__c', 'Quote_Request__c',
    'Reference_Opportunity__c'
];
const STATE_ABBREV = {
    Alabama: 'AL', Alaska: 'AK', Arizona: 'AZ', Arkansas: 'AR', California: 'CA', Colorado: 'CO', Connecticut: 'CT',
    Delaware: 'DE', 'District of Columbia': 'DC', Florida: 'FL', Georgia: 'GA', Hawaii: 'HI', Idaho: 'ID', Illinois: 'IL',
    Indiana: 'IN', Iowa: 'IA', Kansas: 'KS', Kentucky: 'KY', Louisiana: 'LA', Maine: 'ME', Maryland: 'MD',
    Massachusetts: 'MA', Michigan: 'MI', Minnesota: 'MN', Mississippi: 'MS', Missouri: 'MO', Montana: 'MT',
    Nebraska: 'NE', Nevada: 'NV', 'New Hampshire': 'NH', 'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY',
    'North Carolina': 'NC', 'North Dakota': 'ND', Ohio: 'OH', Oklahoma: 'OK', Oregon: 'OR', Pennsylvania: 'PA',
    'Puerto Rico': 'PR', 'Rhode Island': 'RI', 'South Carolina': 'SC', 'South Dakota': 'SD', Tennessee: 'TN',
    Texas: 'TX', Utah: 'UT', Vermont: 'VT', Virginia: 'VA', Washington: 'WA', 'West Virginia': 'WV',
    Wisconsin: 'WI', Wyoming: 'WY', Alberta: 'AB', 'British Columbia': 'BC', Manitoba: 'MB', 'New Brunswick': 'NB',
    'Newfoundland and Labrador': 'NL', 'Northwest Territories': 'NT', 'Nova Scotia': 'NS', Nunavut: 'NU',
    Ontario: 'ON', 'Prince Edward Island': 'PE', Quebec: 'QC', Saskatchewan: 'SK', 'Yukon Territories': 'YT'
};
// "Populate Project" defaults for Homeowner leads (from the prototype). Industry is only the fallback: #124 sets
// Single Family - New for New Construction.
const HOMEOWNER_PROJECT_DEFAULTS = {
    Type_of_record__c: 'Residential',
    Project_Application_Industry__c: 'Single Family - Remodel',
    Project_Application__c: 'Living Room'
};
const WRONG_PROFILE = 'Wrong profile';
const LDR_BCC = 'ldr@nanawall.com';
// "Convert Lead - LDR" screen flow (API name Convert_Lead); takes the Lead Id as recordId, and (v5, Zaid's flow
// update) skipNavigation. Always a RELATIVE path, so it opens in whichever org the inbox runs in (a hard-coded
// production domain sent sandbox Ids to prod).
const leadConvertFlowUrl = (leadId) => '/lightning/flow/Convert_Lead?flow__recordId=' + leadId + '&flow__skipNavigation=true';

/**
 * A lightning-flow statuschange output variable as an Id (outputVariables: [{ name, value }]), or null. Convert_Lead's
 * AccountId / ContactId / OpportunityId outputs are record variables (production, 2026-10-29), so a record gives its Id;
 * a text output (ProjectId) is used as is.
 */
function flowOutput(detail, name) {
    const v = ((detail && detail.outputVariables) || []).find((o) => o.name === name);
    const val = v ? v.value : null;
    if (val && typeof val === 'object') return val.Id || val.id || null;
    return val || null;
}
// Country codes for the Create Lead form (Lead address State/Country picklists are on).
const COUNTRY_CODES = { 'united states': 'US', usa: 'US', us: 'US', canada: 'CA', ca: 'CA', mexico: 'MX', mx: 'MX' };
const FIRST_COUNTRIES = ['US', 'CA', 'MX'];
// Activity owners shown as automation, not a person. 6Sense Integration User creates ~2,100 Tasks a week (prod, 2026-10-21).
const AUTOMATION_USERS = ['Eloqua Partner', '6Sense Integration User'];
const PREVIEW_COUNT = 5;
const LONG_REP_GAP_MINUTES = 1440;

/** Canvas whenOf: "N min ago" / "N hr ago" within a day, otherwise the date (Pacific). */
function relWhen(dt) {
    const t = dt ? new Date(dt).getTime() : NaN;
    if (Number.isNaN(t)) return '';
    const mins = Math.max(0, Math.round((Date.now() - t) / 60000));
    if (mins < 60) return mins + ' min ago';
    if (mins < 1440) return Math.round(mins / 60) + ' hr ago';
    return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Los_Angeles' });
}
/** Days left before the attachment links expire (~30 days after submission). */
function attachDaysLeft(submitted) {
    const t = submitted ? new Date(submitted).getTime() : NaN;
    return Number.isNaN(t) ? 30 : Math.max(0, 30 - Math.floor((Date.now() - t) / 86400000));
}
function when(dt) {
    return dt
        ? new Date(dt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
        : '';
}
// Row left-border colour by customer type (the customer-type chips were removed in 946d).
const TYPE_CLASS = {
    Contractor: 'ldr-type-contractor',
    Architect: 'ldr-type-architect',
    'Business Owner': 'ldr-type-business',
    Homeowner: 'ldr-type-homeowner'
};
const CALL_OUTCOMES = ['Answered \u2014 Interested', 'Left Voicemail', 'No Answer', 'Wrong Number / Bad Data'];
const CONFLICT_PREFIX = 'CONFLICT:';
const VIEW_KEY = 'ldrInbox.view'; // per-browser-tab memory of tab / filter / selected row

function readView() {
    try {
        return JSON.parse(window.sessionStorage.getItem(VIEW_KEY)) || {};
    } catch {
        return {};
    }
}

function writeView(view) {
    try {
        window.sessionStorage.setItem(VIEW_KEY, JSON.stringify(view));
    } catch {
        // storage blocked: the inbox still works, it just won't remember the view
    }
}

function errorText(e) {
    if (!e) return 'Unknown error';
    if (e.body && e.body.message) return e.body.message;
    if (e.body && Array.isArray(e.body)) return e.body.map((x) => x.message).join(', ');
    return e.message || String(e);
}

function safeDecode(v) {
    if (!v) return v;
    try {
        return decodeURIComponent(v);
    } catch {
        return v;
    }
}

const USD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

function money(v) {
    return v === null || v === undefined ? null : USD.format(v);
}

function countLabel(v) {
    return v === null || v === undefined ? '—' : String(v);
}

/**
 * Attachments__c holds one or more upload URLs, newline-separated today (URL-encoded, so file names
 * contain no raw spaces). Also tolerates spaces, commas or semicolons as separators. Only http(s)
 * links are kept, so a malformed value can never become a clickable script link.
 */
/** Inquiry type that means "contact my rep" (kept out of the queue). Matches the Apex EXCLUDED_INQUIRIES, case-insensitive. */
function isRepContact(inquiryType) {
    const v = (inquiryType || '').trim().toLowerCase();
    // Inquiry_Type__c is the field production uses; "Rep Contact" is only a (blank-in-practice) Type__c value.
    return v === 'representative';
}

/**
 * Eloqua adds the Lead/Contact as a Campaign Member on a matching Salesforce Campaign based on the form's source
 * tracking. UTM_Term__c isn't populated in production, so this only classifies by Source / Medium. It doesn't look
 * the Campaign up; it only flags that one should exist.
 */
function expectedCampaignType(s) {
    const med = (safeDecode(s.UTM_Medium__c) || '').toLowerCase();
    const src = (safeDecode(s.UTM_Source__c) || '').toLowerCase();
    if (med.includes('social')) return 'Paid Social';
    if (med.includes('banner') || med.includes('display')) return '3rd Party Banner';
    if (med.includes('cpc') || med === 'search' || (src && med !== 'email' && /google|bing|yahoo/.test(src))) return 'Search';
    return '';
}

function parseAttachments(raw) {
    const seen = new Set();
    return (raw || '')
        .split(/[\s,;]+/)
        .map((u) => u.trim())
        .filter((u) => /^https?:\/\//i.test(u) && !seen.has(u) && seen.add(u))
        .map((url, i) => {
            const name = safeDecode(url.split('?')[0].split('/').pop() || url).replace(/\u202f/g, ' ');
            const dot = name.lastIndexOf('.');
            const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
            // Middle-truncate so similar names (e.g. two screenshots) stay distinguishable.
            const label = name.length > 34 ? name.slice(0, 18) + '…' + name.slice(-13) : name;
            let kind = 'File';
            if (['jpg', 'jpeg', 'png', 'gif', 'heic', 'webp'].includes(ext)) kind = 'Image';
            else if (ext === 'pdf') kind = 'PDF';
            else if (['dwg', 'dxf'].includes(ext)) kind = 'CAD';
            return {
                key: 'att' + i,
                url,
                name,
                label,
                kind,
                number: i + 1,
                isImage: ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext), // HEIC doesn't render in browsers
                isPdf: ext === 'pdf'
            };
        });
}

/**
 * Key campaigns from the UTM fields: competitor search (campaign contains "competitor"),
 * branded search (campaign = "branded"), Windfall cold campaign (campaign contains "windfall").
 */
function campaignCallout(s) {
    const camp = (safeDecode(s.UTM_Campaign__c) || '').trim();
    const c = camp.toLowerCase();
    const src = safeDecode(s.UTM_Source__c) || '';
    const med = safeDecode(s.UTM_Medium__c) || '';
    const term = (safeDecode(s.UTM_Term__c) || '').trim();
    const via = [src, med].filter(Boolean).join(' / ');
    if (c.includes('competitor')) {
        return {
            kind: 'competitor',
            label: 'Competitor', // v6g7 (Aqil; was "Competitor search")
            title: term ? 'Searched for a competitor: ' + term : 'Came from a competitor search ad',
            body: term
                ? 'Tell the rep: they were comparing NanaWall against ' + term + '. (' + (via || 'paid search') + ', campaign "' + camp + '")'
                : 'Tell the rep they were comparing NanaWall against a competitor. UTM term is blank, so we can’t see which company they searched. (' +
                  (via || 'paid search') + ', campaign "' + camp + '")'
        };
    }
    if (c === 'branded') {
        return {
            kind: 'branded',
            label: 'Branded search',
            title: 'Searched for NanaWall by name',
            body: 'They looked us up directly on ' + (src ? src.charAt(0).toUpperCase() + src.slice(1) : 'Google or Bing') + ', so they already know the brand.'
        };
    }
    if (c.includes('pro-conversions') && src.trim().toLowerCase() === 'meta') {
        return {
            kind: 'coldmeta',
            label: 'Cold Meta campaign',
            title: 'Cold Meta campaign (' + camp + ')',
            body: 'Paid Meta ad' + (med ? ' (' + med + ')' : '') +
                ' aimed at people who may not have known NanaWall before, rather than someone searching for us, so expect an introductory conversation.'
        };
    }
    if (c.includes('windfall')) {
        return {
            kind: 'windfall',
            label: 'Windfall cold campaign',
            title: 'Cold homeowner campaign (Windfall)',
            body: 'Targeted homeowner who may not have known NanaWall before. They saw an ad' + (via ? ' via ' + via : '') +
                ' rather than searching for us, so expect an introductory conversation.'
        };
    }
    return null;
}

const SHOWROOM_RADIUS_MILES = 50;
/**
 * NanaWall showrooms / design studios: the 17 locations on nanawall.com/locations (14 from the canvas + 3 added 2026-10-08) (Aziz,
 * 2026-10-07: use this list, NOT the Showroom__c object, whose records are dated). Distance is measured to the
 * showroom's city (city-centre coordinates), not a street address; only Emeryville and Gardena have a confirmed
 * street address and zip. Maintenance: edit this list when a location opens or closes.
 */
const SHOWROOMS = [
    { name: 'SF Bay Area (Emeryville), CA', studio: 'San Francisco Bay Area', url: 'https://www.nanawall.com/locations/emeryville-ca', address: '1150 55th St E, Emeryville, CA 94608', lat: 37.8313, lon: -122.2852 },
    { name: 'Gardena / Los Angeles, CA', studio: 'Gardena, CA', url: 'https://www.nanawall.com/locations/gardena-ca', address: 'Gardena, CA 90248', lat: 33.8883, lon: -118.3092 },
    { name: 'Portland, OR', studio: 'Portland, OR', url: 'https://www.nanawall.com/locations/portland-or', address: 'Portland, OR', lat: 45.5152, lon: -122.6784 },
    { name: 'Kirkland, WA', studio: 'Kirkland, WA', url: 'https://www.nanawall.com/locations/kirkland-wa', address: 'Kirkland, WA', lat: 47.6769, lon: -122.206 },
    { name: 'Salt Lake City, UT', studio: 'Salt Lake City, UT', url: 'https://www.nanawall.com/locations/salt-lake-city-ut', address: 'Salt Lake City, UT', lat: 40.7608, lon: -111.891 },
    { name: 'Englewood (Denver), CO', studio: 'Englewood, CO', url: 'https://www.nanawall.com/locations/englewood-co', address: 'Englewood, CO', lat: 39.6478, lon: -104.9878 },
    { name: 'Long Island City, NY', studio: 'Long Island City, NY', url: 'https://www.nanawall.com/locations/long-island-city-ny', address: 'Long Island City, NY', lat: 40.7447, lon: -73.9485 },
    { name: 'Chicago, IL', studio: 'Chicago, IL', url: 'https://www.nanawall.com/locations/chicago-il', address: 'Chicago, IL', lat: 41.8781, lon: -87.6298 },
    { name: 'Strongsville, OH', studio: 'Strongsville, OH', url: 'https://www.nanawall.com/locations/strongsville-oh', address: 'Strongsville, OH', lat: 41.3145, lon: -81.8357 },
    { name: 'Carmel, IN', studio: 'Carmel, IN', url: 'https://www.nanawall.com/locations/carmel-in', address: 'Carmel, IN', lat: 39.9784, lon: -86.118 },
    { name: 'Wixom, MI', studio: 'Wixom, MI', url: 'https://www.nanawall.com/locations/wixom-mi', address: 'Wixom, MI', lat: 42.5248, lon: -83.5366 },
    { name: 'Omaha, NE', studio: 'Omaha, NE', url: 'https://www.nanawall.com/locations/omaha-ne', address: 'Omaha, NE', lat: 41.2565, lon: -95.9345 },
    { name: 'Dallas, TX', studio: 'Dallas, TX', url: 'https://www.nanawall.com/locations/dallas-tx', address: 'Dallas, TX', lat: 32.7767, lon: -96.797 },
    { name: 'Tempe, AZ', studio: 'Tempe, AZ', url: 'https://www.nanawall.com/locations/tempe-az', address: 'Tempe, AZ', lat: 33.4255, lon: -111.94 },
    // Added 2026-10-08 (Aziz): on nanawall.com/locations but not in the canvas list. City-centre coordinates.
    { name: 'Montréal, QC', studio: 'Montréal, QC', url: 'https://www.nanawall.com/locations/mont-royal-qc', address: 'Mont-Royal, QC', lat: 45.5167, lon: -73.645 },
    { name: 'Toronto, ON', studio: 'Toronto, ON', url: 'https://www.nanawall.com/locations/ontario', address: 'Toronto, ON', lat: 43.6532, lon: -79.3832 },
    { name: 'San Pedro Garza García, N.L.', studio: 'San Pedro, N.L.', url: 'https://www.nanawall.com/locations/san-pedro-nle', address: 'San Pedro Garza García, N.L., Mexico', lat: 25.6573, lon: -100.4026 }
];

/** Straight-line (Haversine) distance in miles. Not driving distance. */
function distanceMiles(lat1, lon1, lat2, lon2) {
    const R = 3958.8;
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Nearest showroom (SHOWROOMS) within SHOWROOM_RADIUS_MILES of the given point, or null. */
function nearestShowroom(lat, lon) {
    if (lat === null || lat === undefined || lon === null || lon === undefined) return null;
    // Salesforce's placeholder geocode for an unresolved US address (New York City centre): treat as no location.
    if (Math.abs(lat - 40.71427) < 0.0001 && Math.abs(lon + 74.00597) < 0.0001) return null;
    let best = null;
    let bestDist = Infinity;
    SHOWROOMS.forEach((sr) => {
        const d = distanceMiles(lat, lon, sr.lat, sr.lon);
        if (d < bestDist) {
            bestDist = d;
            best = sr;
        }
    });
    return best && bestDist <= SHOWROOM_RADIUS_MILES ? { ...best, miles: Math.round(bestDist) } : null;
}

/** 'won' | 'lost' | 'open' from an Opportunity stage name (drives the stage pill and card accent colours). */
function stageTone(stage) {
    const st = (stage || '').toLowerCase();
    if (st.includes('closed won')) return 'won';
    if (st.includes('closed lost')) return 'lost';
    return 'open';
}

function lastNameOf(s, name) {
    let ln = (s.Last_Name__c || (name || '').trim().split(/\s+/).pop() || '').trim();
    return ln ? ln.charAt(0).toUpperCase() + ln.slice(1) : '';
}

function formProjectName(s, r) {
    if (s.Project_Name__c) return s.Project_Name__c;
    if (r.customerType === 'Homeowner') {
        const ln = lastNameOf(s, r.name);
        return ln ? ln + ' Residence' : '';
    }
    return '';
}

/** Title-cased US/Canadian state or province name the Project Site State picklist accepts, else ''. */
function stateForPicklist(value) {
    const v = (value || '').trim();
    if (!v) return '';
    const byCode = Object.keys(STATE_ABBREV).find((k) => STATE_ABBREV[k] === v.toUpperCase());
    if (byCode) return byCode;
    return Object.keys(STATE_ABBREV).find((k) => k.toLowerCase() === v.toLowerCase()) || '';
}

/** Up to 5 flags on a prospect card (Aziz, 2026-10-13). With more than 5, the weakest go first (info, then good); order kept. */
function cardChips(chips) {
    if (chips.length <= 5) return chips;
    const rank = (c) => (c.kind === 'warn' ? 0 : c.kind === 'hot' ? 1 : c.kind === 'good' ? 2 : 3);
    const keep = chips
        .map((c, i) => ({ i, r: rank(c) }))
        .sort((a, b) => a.r - b.r || a.i - b.i)
        .slice(0, 5)
        .map((x) => x.i);
    return chips.filter((c, i) => keep.includes(i));
}

/** 6sense CE status -> [label, fill, text] (canvas 5041: one colour per outcome). */
const CE_STATUS = {
    in_progress: ['In a 6sense campaign now', '#2F6DAB', '#FFFFFF'],
    not_started: ['Queued for a 6sense campaign', '#6556B8', '#FFFFFF'],
    qualified: ['6sense: Qualified', '#2E8452', '#FFFFFF'],
    human_review: ['6sense: Human review', '#E0A526', '#3D2A00'],
    unresponsive: ['6sense: Unresponsive', '#707070', '#FFFFFF'],
    not_interested: ['6sense: Not interested', '#C8102E', '#FFFFFF'],
    not_interested_now: ['6sense: Not interested now', '#B0477A', '#FFFFFF'],
    canceled: ['6sense: Canceled', '#1F7F86', '#FFFFFF'],
    bounced: ['6sense: Bounced', '#5B3E9E', '#FFFFFF'],
    enrollment_error: ['6sense: Enrollment error', '#3D3D3D', '#FFFFFF']
};

function firstName(n) {
    return (n || '').trim().split(/\s+/)[0] || '';
}

function toTime(v) {
    if (!v) return null;
    const t = new Date(v).getTime();
    return Number.isNaN(t) ? null : t;
}

// ---------------------------------------------------------------- Post Quote (canvas #139-#142)
// Each reply row is keyed "PQ-<contactId>-<projectId or name>"; those keys never reach the queue's selectRow / Apex.
const PQ_TAG_LABEL = { Updated: 'Updated', Escalated: 'Escalated', FJTRSent: 'FJTR Sent', NoActionNeeded: 'No Action Needed' };
// 6sense campaign segment "6S.4.EV.<HO|C|A>.<SFR|COM>_…" -> customer type / residential or commercial
const PQ_SEGMENT_TYPE = { HO: 'Homeowner', C: 'Contractor', A: 'Architect' };
const PQ_SEGMENT_KIND = { SFR: 'Residential', COM: 'Commercial' };
const PQ_FILTERS = ['Mine', 'No Project Coordinator', 'All LDRs'];

function isPqKey(id) {
    return typeof id === 'string' && id.startsWith('PQ-');
}

function pqAge(v) {
    const m = Math.max(0, Math.round((Date.now() - new Date(v).getTime()) / 60000));
    return m < 60 ? m + 'm' : m < 1440 ? Math.round(m / 60) + 'h' : Math.round(m / 1440) + 'd';
}

function pqDateTime(v) {
    if (!v) return '';
    const d = new Date(v);
    return d.toLocaleDateString('en-US') + ' ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function selectOptions(list, current) {
    return list.map((o) => ({ ...o, selected: o.value === current }));
}

function gapLabel(mins) {
    if (mins < 60) return mins + ' min apart';
    if (mins < 1440) return Math.round(mins / 60) + ' hr apart';
    return Math.round(mins / 1440) + ' days apart';
}

function ageLabel(mins, submitted) {
    if (mins < 60) return mins + 'm';
    if (mins < 1440) return Math.round(mins / 60) + 'h';
    return new Date(submitted).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default class LdrInbox extends NavigationMixin(LightningElement) {
    /** Response target for unclaimed submissions, in minutes. Set in Lightning App Builder. */
    @api slaMinutes = 15;
    /** How far back unclaimed submissions are loaded, in days. */
    @api lookbackDays = 30;
    /** Auto-refresh interval in seconds (0 = off). */
    @api refreshSeconds = 60;

    /** True when the inbox is running inside a Lightning console app. */
    @wire(IsConsoleNavigation) isConsole;

    /** Lead picklists for the Create Lead form (Status, Type__c, CountryCode, dependent StateCode). */
    @wire(getObjectInfo, { objectApiName: LEAD_OBJECT }) leadInfo;

    @wire(getPicklistValuesByRecordType, { objectApiName: LEAD_OBJECT, recordTypeId: '$leadRecordTypeId' })
    wiredLeadPicklists({ data }) {
        if (data) this.leadPicklists = data.picklistFieldValues || {};
    }

    get leadRecordTypeId() {
        return this.leadInfo && this.leadInfo.data ? this.leadInfo.data.defaultRecordTypeId : undefined;
    }

    rows = [];
    meId;
    meName = '';
    coordinators = {}; // Project Coordinator choices: User Id -> name (getQueue)
    statusValues = [];
    outcomeValues = [];
    contactStatusValues = [];
    contactOutcomeValues = [];
    contactConvertedAt = {};
    assignedByMap = {};
    isAdmin = false;
    viewAsId = ''; // '' = yourself; BOSS_VIEW = yourself + edit unclaimed; else a user Id // admins only: whose Mine / Finished / Team / no-outreach to show ('' = yourself)
    statusChangedAt = {};
    lastActivityBy = {};
    contactLeadTypes = {};
    openOppOwners = {};
    sixSense = {};
    sixSenseValues = [];
    courses = {};
    estimatesEnabled = false;
    collapsedGroups = {};
    convertedContacts = {};
    followUpMap = {};
    estimateError = '';
    sixSenseDraft = null; // { id, value } while the Follow Up 6Sense Option differs from the saved value
    emailCopied = null; // 'ok' | 'failed'
    // Convert Lead window (canvas #129): { id, leadId, name, firstName, step: 'flow' | 'files', contactId, opportunityId,
    // opportunityName, fileLinks, uploaded }. Keeps its own leadId: after the reload the row is the Contact.
    convertState = null;
    attachOpp = null; // canvas #119: { id, contactId, step: 'flow' | 'files', opportunityId, ... } while the window is open
    fetrProjectPick = {}; // canvas #120: submission Id -> the FETR project the LDR picked (kept for the session)
    fetrEdits = {}; // v6f8: submission Id -> { FETR row id: typed-over value } (kept for the session, never saved)
    relatedExpanded = false;
    unclaimedCoordFilter = 'All';
    recordFilter = 'All';
    recTypeFilter = 'All';
    statusFilter = 'All';
    activityPreview = null;
    confirm = null; // { kind: 'reassign' | 'claimFrom', text }
    claimCtx = null; // { previousCoordinatorId, previousCoordinatorName, canReassign }
    creatingLead = false;
    leadForm = {};
    leadFormTried = false;
    leadPicklists = {};
    preBase = {}; // Project Details values as loaded by the Lead form (for "Unsaved changes")
    draftBase = { status: '', outcome: '', pre: {} };
    lightboxIndex = null; // index into the active submission's image attachments
    dismissedAlerts = {}; // "<submissionId>:<key>" -> true
    dismissedTop = {}; // v5.7: page-level banner key -> what it said when it was closed (topVisible)
    formNonce = 0; // bumped by Cancel so the edit forms are rebuilt instead of reset() (lookup-safe)
    coordinatorFilter = 'All'; // Team tab: show one LDR's claims
    quickEditOpen = false;
    // Quick Edit (canvas #137 / #138): the mailing address draft (codes), its error line, saving state
    qeAddr = {};
    qeError = '';
    qeSaving = false;
    _qeLoaded = false;
    junkMenuOpen = false;
    contactOpps = [];
    loadedAt;

    tab = 'unclaimed';
    activeId;
    // ---- canvas a111
    queueRows = [];
    prospectRows = []; // unclaimed prospects (Prospects tab), loaded on first open
    prospectsLoaded = false;
    prospectsLoading = false;
    prospectError = '';
    prospectSince = '';
    prospectDays = null; // #149 B: the Prospects window in days (Apex PROSPECT_DAYS)
    prospectCapped = false;
    configuratorClaimable = false;
    prospectList = 'estimates';
    prospectElseOpen = {};
    prospectHiddenOpen = {};
    prospectWorthAll = {};
    cfgDetail = {}; // personId -> ConfigQuote[]
    cfgQuotesAll = false;
    formFilter = 'All';
    bossTab = 'inbox';
    allSubs = [];
    allSubsRange = '365';
    allSubsFrom = '';
    allSubsTo = '';
    allSubsLoading = false;
    allSubsError = '';
    allSubsCoordFilter = 'All'; // All Submissions' own Project Coordinator filter (notes #90), separate from Unclaimed's
    relinkNoticeDismissed = false;
    relinkListOpen = false;
    uncontacted = []; // #146: UncontactedRow[] for the viewer
    uncontactedOpen = false;
    _uncSeq = 0;
    linkFixTried = {};
    linkFixError = '';
    emailMatch = null; // { id, text } for the selected unlinked submission
    seqFilter = 'all'; // Mine / All: all | active | unseq | finished (Outreach sequence state, canvas 55a9)
    contactWindfall = {}; // Contact Id -> Windfall fields (converted Lead's when the Contact has none; "__fromLead")
    prospectCoordFilter = 'All'; // Prospects: Project Coordinator on the Lead / Contact (canvas 9fed)
    userTab = 'inbox'; // everyone but Boss View: inbox | dash (My Dashboard) | estimate | leadviews (admins)
    // Post Quote (canvas #139-#142): the inbox loads the replies for every LDR (tab counts, Finished / All tails)
    pqRows = [];
    pqLoaded = false;
    pqLoading = false;
    pqError = '';
    pqSince = '';
    pqPicklists = { proj: [], reason: [], lostTo: [], opp: [] };
    pqFilter = 'Mine';
    pqCollapsed = {}; // card key -> true when its earlier emails are folded away
    _pqSeq = 0;
    _evalCache = null;
    related = [];
    person = [];
    account = null;
    accountOpps = [];
    searchQuery = '';
    xtAllFor = ''; // canvas #143: "Show all" is on while the search equals this text
    // canvas #144 / #145A: Salesforce search in the tab bar
    spText = '';
    spQuery = '';
    spOpen = false;
    spLoading = false;
    spError = '';
    spPeople = [];
    spCapped = false;
    _spSeq = 0;
    sortOrder = 'newest';
    historyExpanded = false;
    activityExpanded = false;
    history = [];
    activity = [];
    timelineLoaded = false;
    showEmailPreview = false;
    emailTemplate = ''; // Draft email message template: '' | request | estSmall | estLarge | handoff (canvas aabc)
    emailMessage = null; // Draft email message as edited (#152 H); null = the template's text, untouched
    emailSubjectEdit = null; // v6g3: Draft email subject as edited; null = the automatic one
    projectDetailsOpen = false;
    autoFilled = {}; // v5.7: field -> value Populate Project filled in (highlighted until changed, saved or cancelled)
    headerSplit = 99; // v6e: how many header buttons fit beside the name (measureHeader); the rest go beside line 1
    legacyClaimDates = false; // #156: admins, a claimed record still lacks ClaimedDate__c (one-time move)
    // 6Sense tab (#151): getSixSenseReplies result, and the person to open from a search match ({ key, box, nonce })
    ssData = null;
    ssLoading = false;
    ssError = '';
    ssFocus = null;
    _ssSeq = 0;
    tookOverFrom = null;
    tookOverAt = null; // ms: when the claim happened (#152 E)
    tookOverDismissed = {}; // submissionId -> ms dismissed (#152 E; localStorage per user)
    savingLeadFields = false;
    kbmaxCounts = {};
    estimateCounts = {};
    hiddenFields = [];
    draft = { status: '', outcome: '', project: '', notes: '', pre: {} };

    loading = true;
    busy = false;
    loadError;
    conflictMsg;
    refreshingLink = false;
    message;
    loggingCall = false;
    callOutcome = ''; // Log a call (canvas aabc, #96E): the picked outcome; Save creates the Task
    callNotes = '';

    _timer;
    _relatedFor;
    // Request counters: a reply from an older load() / loadAllSubs() is dropped so it can't overwrite a newer one.
    _loadSeq = 0;
    _allSubsSeq = 0;
    _convertCheck = null; // the Convert window's conversion check in progress (checkConversion)

    // ------------------------------------------------------------ lifecycle

    connectedCallback() {
        // NanaWall brand fonts (static resource). Falls back to the system fonts in the font stack if it fails.
        loadStyle(this, NANAWALL_FONTS + '/fonts.css').catch(() => {});
        // v6f1: spacing inside the base components (labels, Project Details popup); see the file's header
        loadStyle(this, BASE_STYLES).catch(() => {});
        // Restore the LDR's tab, filter and selected row if the page was re-rendered
        // (e.g. after navigating away and back in a standard-navigation app).
        const v = readView();
        if (v.tab && TABS.some((t) => t.key === v.tab)) this.tab = v.tab;
        if (v.activeId) this.activeId = v.activeId;
        if (v.sortOrder === 'oldest' || v.sortOrder === 'newest') this.sortOrder = v.sortOrder;
        this.load();
        // Not on the silent refresh timer: up to 2,000 email bodies per call (reloads on ↻ and after Post Quote edits).
        this.loadPostQuote();
        const secs = Number(this.refreshSeconds);
        if (secs > 0) {
            // eslint-disable-next-line @lwc/lwc/no-async-operation
            this._timer = setInterval(() => {
                if (!this.busy) this.load(true);
            }, Math.max(15, secs) * 1000);
        }
    }

    /**
     * A native <textarea> ignores a value={…} binding (compiler warning LWC1057: it showed empty in the LWC preview), so
     * the Draft Email message box carries its text in data-text and is filled here, only when it differs (so typing
     * doesn't move the caret).
     */
    renderedCallback() {
        const ta = this.template.querySelector('textarea.ldr-email-msg');
        if (ta && ta.value !== (ta.dataset.text || '')) ta.value = ta.dataset.text || '';
        // v6f8: the FETR's multi-line values, likewise (they grow with their text in CSS, field-sizing)
        this.template.querySelectorAll('textarea.ldr-fetr-ta').forEach((t) => {
            if (t.value !== (t.dataset.text || '')) t.value = t.dataset.text || '';
        });
        this.measureHeader();
    }

    disconnectedCallback() {
        if (this._timer) clearInterval(this._timer);
        if (this._headerRo) this._headerRo.disconnect();
        if (this._headerResize) window.removeEventListener('resize', this._headerResize);
    }

    // ------------------------------------------------------------ record header buttons (v6e)

    /**
     * The record header's buttons, in order. One list, so they can be split between the row beside the name and the
     * row beside line 1 (headerSplit).
     */
    get headerButtons() {
        const a = this.active;
        if (!a) return [];
        const out = [];
        const add = (b) => out.push({ ...b, key: 'hb-' + b.id, idx: out.length });
        const btn = (id, cls, label, action, extra) => add({ id, cls: 'ldr-btn ' + cls, label, action, ...(extra || {}) });
        if (a.canClaim) btn('claim', 'ldr-btn-primary', a.claimLabel, 'claim', { disabled: this.busy });
        if (a.isMine) {
            add({ id: 'mine', isBadge: true, cls: 'ldr-badge ldr-badge-mine', label: 'Claimed by you' });
            if (a.canReassign) btn('reassign', 'ldr-btn-green-outline', 'Reassign', 'askReassign', { disabled: this.busy, title: a.reassignTitle });
            btn('release', 'ldr-btn-green-outline', 'Release', 'release', { disabled: this.busy });
        }
        if (a.isOthers) {
            add({ id: 'others', isBadge: true, cls: 'ldr-badge', label: 'Claimed by ' + a.claimedByName });
            btn('claimfrom', 'ldr-btn-primary', a.claimLabel, 'askClaimFrom', { disabled: this.busy });
        }
        if (a.hasLinkedRecord) {
            btn('record', 'ldr-btn-teal', a.recordButtonLabel, 'openLead');
            btn('quickedit', 'ldr-btn-teal', 'Quick Edit', 'toggleQuickEdit');
        }
        btn('submission', 'ldr-btn-outline', a.submissionLabel, 'openSubmission');
        if (a.telHref) add({ id: 'call', cls: 'ldr-btn ldr-btn-teal', label: 'Call', href: a.telHref });
        if (a.hasLinkedRecord) btn('logcall', 'ldr-btn-teal', 'Log Call', 'startLogCall', { disabled: a.logCallDisabled, title: a.logCallTitle });
        if (a.mailtoHref) btn('email', 'ldr-btn-teal', 'Draft Email', 'startEmailPreview');
        return out;
    }

    get headerButtonsTop() {
        return this.headerButtons.slice(0, this.headerSplit);
    }

    get headerButtonsBottom() {
        return this.headerButtons.slice(this.headerSplit);
    }

    get hasHeaderButtonsBottom() {
        return this.headerButtonsBottom.length > 0;
    }

    /** Line 1's row, marked while buttons sit beside it (they're then at most half its width, ldrInbox.css v6f7). */
    get headerMidRowCls() {
        return 'ldr-d-hrow ldr-d-hrow-mid' + (this.hasHeaderButtonsBottom ? ' ldr-d-hrow-split' : '');
    }

    handleHeaderButton(e) {
        const action = e.currentTarget.dataset.action;
        const allowed = ['claim', 'askReassign', 'release', 'askClaimFrom', 'openLead', 'toggleQuickEdit', 'openSubmission', 'startLogCall', 'startEmailPreview'];
        if (allowed.includes(action)) this[action]();
    }

    /**
     * How many header buttons fit beside the name: the top row's width minus the name's, in button order. Button widths
     * don't depend on which row they're in, so this settles after one re-render. Re-measured on every render and when the
     * header, the name or the top buttons resize (window, Salesforce side panels, the brand font arriving late).
     * v6f7: the name box never shrinks (ldrInbox.css), so its width is the name's real width. It used to shrink when the
     * top row was too full, which made the room look bigger and kept the extra buttons on top, wrapping into a second row
     * there (three rows with the ones beside line 1). 1px to spare for rounding.
     */
    measureHeader() {
        const row = this.template.querySelector('.ldr-d-hrow-top');
        if (!row) return;
        this.watchHeader(row);
        const title = row.querySelector('.ldr-d-titlerow');
        const items = Array.from(this.template.querySelectorAll('.ldr-d-head157 [data-hb]')).sort((x, y) => Number(x.dataset.hb) - Number(y.dataset.hb));
        const room = row.clientWidth - (title ? title.getBoundingClientRect().width : 0) - HEADER_NAME_GAP - 1;
        let used = 0;
        let fit = 0;
        for (const el of items) {
            const next = used + (fit ? HEADER_BUTTON_GAP : 0) + el.getBoundingClientRect().width;
            if (next > room) break;
            used = next;
            fit += 1;
        }
        if (fit !== this.headerSplit) this.headerSplit = fit;
    }

    watchHeader(row) {
        if (this._headerRow === row) return;
        this._headerRow = row;
        if (typeof ResizeObserver === 'function') {
            if (this._headerRo) this._headerRo.disconnect();
            this._headerRo = new ResizeObserver(() => this.measureHeader());
            this._headerRo.observe(row);
            // v6f7: the name and the top buttons too, so a late font change is picked up
            row.querySelectorAll('.ldr-d-titlerow, .ldr-d-actions-top').forEach((el) => this._headerRo.observe(el));
        } else if (!this._headerResize) {
            this._headerResize = () => this.measureHeader();
            window.addEventListener('resize', this._headerResize);
        }
    }

    /**
     * getQueue, retried once after a short pause when Salesforce answers with its generic "An internal server error has
     * occurred" (seen twice in production, 2026-10-14). Other errors are shown straight away.
     */
    async getQueueWithRetry() {
        const args = { lookbackDays: Number(this.lookbackDays) || 30 };
        try {
            return await getQueue(args);
        } catch (e) {
            if (!/internal server error/i.test(errorText(e))) throw e;
            // eslint-disable-next-line @lwc/lwc/no-async-operation
            await new Promise((resolve) => setTimeout(resolve, 1500));
            return getQueue(args);
        }
    }

    async load(silent) {
        // The refresh timer and the action handlers can overlap; only the latest request may apply its queue.
        const seq = ++this._loadSeq;
        if (!silent) this.loading = true;
        try {
            const r = await this.getQueueWithRetry();
            if (seq !== this._loadSeq) return;
            const firstLoad = this.meId !== r.userId;
            this.meId = r.userId;
            this.meName = r.userName;
            this.coordinators = r.coordinators || {};
            if (firstLoad) this.loadTookOverDismissed();
            this.statusValues = r.statusOptions || [];
            this.outcomeValues = r.outcomeOptions || [];
            this.contactStatusValues = r.contactStatusOptions || [];
            this.contactOutcomeValues = r.contactOutcomeOptions || [];
            this.contactConvertedAt = r.contactConvertedAt || {};
            this.assignedByMap = r.assignedBy || {};
            this.isAdmin = !!r.isAdmin;
            this.legacyClaimDates = !!r.legacyClaimDates; // #156 one-time move
            if (firstLoad && this.isAdmin) this.loadSixSense(); // #151 (↻ and a 6Sense save reload it)
            // #152 A: a saved 6Sense tab (readView) is only for the admins
            if (this.tab === 'sixsense' && !this.showSixSense) this.tab = 'unclaimed';
            this.statusChangedAt = r.statusChangedAt || {};
            this.lastActivityBy = r.lastActivityBy || {};
            this.contactLeadTypes = r.contactLeadTypes || {};
            this.openOppOwners = r.openOppOwners || {};
            this.sixSense = r.sixSense || {};
            this.sixSenseValues = r.sixSenseOptions || [];
            this.courses = r.courses || {};
            this.estimatesEnabled = !!r.estimatesEnabled;
            this.estimateError = r.estimateError || '';
            this.convertedContacts = r.convertedContacts || {};
            this.followUpMap = r.followUp || {};
            this.loadedAt = r.loadedAt;
            this.kbmaxCounts = r.kbmaxCounts || {};
            this.estimateCounts = r.estimateCounts || {};
            this.hiddenFields = r.hiddenFields || [];
            this.configuratorClaimable = !!r.configuratorClaimable;
            this.contactWindfall = r.contactWindfall || {};
            this.queueRows = (r.submissions || [])
                .map((s) => this.mapRow(s))
                .concat((r.estimates || []).map((e) => this.mapRow(normalizeEstimate(e))))
                .concat((r.configurator || []).map((p) => this.mapRow(this.configuratorSubmission(p))));
            this.mergeRows();
            if (!silent) this.runLinkFixes((r.submissions || []).concat(r.estimates || []));
            if (this.tab === 'prospects' && !this.prospectsLoaded && !this.prospectsLoading) this.loadProspects();
            this.loadError = undefined;
            if (!silent) this.loadUncontacted(); // #146 (not on the silent timer: ~6 queries; ↻ and every write reload it)
            // A Post Quote reply stays selected; the Post Quote tab picks its own first row (loadPostQuote).
            if (isPqKey(this.activeId) || (this.tab === 'postquote' && !this.activeId)) {
                // nothing to select in the queue
            } else if (!this.activeId || !this.rows.find((x) => x.id === this.activeId)) {
                const first = this.firstQueueItem();
                if (first) this.selectRow(first.id);
            } else if (this._resetAfterLoad || !this.ldrDirty) {
                this.resetDraft();
            }
            this._resetAfterLoad = false;
            if (!silent && this.activeId && !isPqKey(this.activeId) && !this._relatedFor) {
                // Selection restored from sessionStorage: load everything selectRow would (configurator quotes and
                // the email match too, which used to be skipped and left "Loading…" on a restored configurator row).
                this._relatedFor = this.activeId;
                this.loadSelectionData();
            }
        } catch (e) {
            if (seq === this._loadSeq) this.loadError = errorText(e);
        } finally {
            if (seq === this._loadSeq) this.loading = false;
        }
    }

    // ------------------------------------------------------------ mapping

    /**
     * A submission on a CONVERTED Lead (Contact__c blank) is worked as the Contact the Lead became
     * (Lead__r.ConvertedContactId); one linked to both a Lead and a Contact is worked as the Contact. Claiming such a
     * row also writes Contact__c (Apex). The original Lead Id is kept as convertedLeadId.
     */
    normalizeLinks(input) {
        const lr = input.Lead__r || {};
        if (input.Lead__c && !input.Contact__c && lr.IsConverted && lr.ConvertedContactId) {
            return {
                ...input,
                Contact__c: lr.ConvertedContactId,
                Contact__r: this.convertedContacts[lr.ConvertedContactId] || { Id: lr.ConvertedContactId },
                Lead__c: null,
                Lead__r: null,
                convertedLeadId: input.Lead__c,
                contactOnlyViaLead: true
            };
        }
        if (input.Lead__c && input.Contact__c) {
            return {
                ...input,
                Contact__r: input.Contact__r || this.convertedContacts[input.Contact__c] || { Id: input.Contact__c },
                Lead__c: null,
                Lead__r: null,
                convertedLeadId: input.Lead__c
            };
        }
        return input;
    }

    /** Rep-display routing input (canvas 7c73): Territory__c first, then project type, then location. */
    routeInput(r, state, zip) {
        const s = r.raw || {};
        const lead = s.Lead__r || {};
        const contact = s.Contact__r || {};
        return {
            owner: r.owner === 'Unassigned' ? '' : r.owner,
            territory: (r.isContactLinked ? contact.Territory__c : lead.Territory__c) || lead.Territory__c || contact.Territory__c || '',
            state: state || s.State_or_Province__c,
            zip: zip || s.Zip_or_Postal_Code__c,
            customerType: r.customerType,
            // #118: Homeowner on the form, the Lead (Type__c) or the Contact (LeadType__c) decides residential
            customerTypes: [s.Customer_Type__c, lead.Type__c, contact.LeadType__c, s.Contact__c ? this.contactLeadTypes[s.Contact__c] : ''].filter(Boolean),
            isEstimate: !!r.isEstimate,
            isConfigurator: !!r.isConfigurator,
            kbProjectType: (r.kb || {}).projectType || '',
            typeOfRecord: lead.Type_of_record__c || '',
            appIndustry: lead.Project_Application_Industry__c || '',
            application: s.Project_Application__c || s.Application__c || ''
        };
    }

    mapRow(input) {
        const s0 = this.normalizeLinks(input);
        const str = (v) => (typeof v === 'string' ? v : '');
        const fsComments = s0.isEstimate || s0.isConfigurator ? '' : str(s0.Comments__c);
        const rawQc = str(s0.Questions_or_Comments__c);
        // Display copy: a form's old Comments__c without tags; on an estimate / configurator row Comments__c is the tag
        // field (#156), so it's blanked here and never shown as the customer's comments.
        let s = fsComments || s0.isEstimate || s0.isConfigurator ? { ...s0, Comments__c: fsComments ? stripFixTags(fsComments) : '' } : s0;
        // Tags written before #156 sit in Questions or Comments (#NoContactNeeded on forms too): stripped wherever shown.
        if (rawQc) s = { ...s, Questions_or_Comments__c: stripFixTags(rawQc) };
        // #156: the automation tags (#LinkFixed..., #FixReviewed, #Junk:<reason>, #NoContactNeeded) are in Comments1__c
        // on a form submission and Comments__c on an instant estimate / 3D configurator quote. Until the one-time move has
        // run, older ones are still in the old place (form Comments__c, the end of an estimate's Questions or Comments).
        const newTags = str(s0.isEstimate || s0.isConfigurator ? s0.Comments__c : s0.Comments1__c);
        const oldTags = s0.isEstimate ? rawQc : fsComments;
        const tagText = [newTags, oldTags].filter(Boolean).join(' ');
        const lead = s.Lead__r || {};
        const contact = s.Contact__r || {};
        const isContactLinked = !s.Lead__c && !!s.Contact__c;
        // No Lead or Contact yet: Eloqua/Salesforce usually links one shortly after the form comes in.
        const isUnlinked = !s.Lead__c && !s.Contact__c;
        const submitted = s.Submit_Time__c || s.CreatedDate;
        const mins = Math.max(0, Math.round((Date.now() - new Date(submitted).getTime()) / 60000));
        // canvas #156: Mine, Finished and All are dated and sorted by the claim time (ClaimedDate__c; junk = the junk
        // time), else the submitted time. Replaces #132's Last Modified.
        const claimedAt = s.ClaimedDate__c || null;
        const claimMins = claimedAt ? Math.max(0, Math.round((Date.now() - new Date(claimedAt).getTime()) / 60000)) : mins;
        const name = [s.First_Name__c, s.Last_Name__c].filter(Boolean).join(' ') || lead.Name || contact.Name || s.Name;
        const campaign = campaignCallout(s);
        // The record's own type is the source of truth, so an LDR correcting it shows up here: Lead.Type__c on a Lead,
        // the Contact's Lead Type (LeadType__c) on a Contact (v5.7; was the form's). The form's value is only the
        // fallback when the record has none. What They Submitted still shows the form's Customer Type.
        const contactLeadType = s.Contact__c ? contact.LeadType__c || this.contactLeadTypes[s.Contact__c] || '' : '';
        const customerType = (isContactLinked ? contactLeadType : lead.Type__c) || s.Customer_Type__c || 'Unknown';
        const location = [s.City__c, s.State_or_Province__c].filter(Boolean).join(', ');
        const zip = s.Zip_or_Postal_Code__c;
        // Contact-linked: status / reason / outcome / coordinator live on the Contact (Lead Funnel Status).
        const rec = isContactLinked
            ? {
                  status: contact.Lead_Funnel_Status__c || '',
                  outcome: contact.Lead_Funnel_Outcome__c || '',
                  coordinatorId: contact.Project_Coordinator__c || null,
                  coordinatorName: contact.Project_Coordinator__r ? contact.Project_Coordinator__r.Name : null
              }
            : {
                  status: lead.Status || '',
                  outcome: lead.Lead_Funnel_Outcome__c || '',
                  coordinatorId: lead.Project_Coordinator__c || null,
                  coordinatorName: lead.Project_Coordinator__r ? lead.Project_Coordinator__r.Name : null
              };
        // The Lead was converted (into this Contact) after the form came in, before anyone claimed it.
        const convertedAt = isContactLinked ? this.contactConvertedAt[s.Contact__c] || null : null;
        const convertedAfter = !!convertedAt && new Date(convertedAt) > new Date(submitted);
        const recId = s.Lead__c || s.Contact__c || null;
        const oppOwners = isContactLinked ? this.openOppOwners[s.Contact__c] || [] : [];
        return {
            id: s.Id,
            isEstimate: !!s.isEstimate,
            estimate: s.estimate || null,
            estimatePreview: s.isEstimate ? estimatePreview(s.estimate) : '',
            sixSense: recId ? this.sixSense[recId] || '' : '',
            followUp: recId ? this.followUpMap[recId] || {} : {},
            contactOnlyViaLead: !!s.contactOnlyViaLead,
            convertedLeadId: s.convertedLeadId || null,
            leadId: s.Lead__c,
            contactId: s.Contact__c || null,
            recordId: s.Lead__c || s.Contact__c || null,
            isUnlinked,
            // Lead converted (only loaded for my own recent claims, for the Finished tab).
            isConverted: !!(s.Lead__c && lead.IsConverted),
            leadConvertedAt: s.Lead__c && lead.IsConverted ? lead.ConvertedDate || null : null,
            recordKind: s.Lead__c ? 'Lead' : s.Contact__c ? 'Contact' : 'No record yet',
            // Type filter: Lead.Type__c on Leads, Contact.LeadType__c ("Lead Type") on Contacts.
            recordType: s.Lead__c ? lead.Type__c || '' : contactLeadType,
            statusChangedAt: recId ? this.statusChangedAt[recId] || null : null,
            claimedAt,
            funnelTs: (isContactLinked ? contact.Lead_Funnel_Time_Stamp__c : lead.Lead_Funnel_Time_Stamp__c) || null,
            openOppCount: oppOwners.length,
            openOppOwners: Array.from(new Set(oppOwners.filter(Boolean))),
            // Who set Claimed_By__c to someone else (from Form_Submission__c field history, when enabled).
            assignedBy: this.assignedByMap[s.Id] || null,
            isContactLinked,
            campaign,
            name,
            company: s.Company__c,
            email: s.Email_Address__c,
            phone: s.Phone_Number__c,
            form: formName(s.Type__c || s.Inquiry_Type__c || 'Form'),
            customerType,
            location: zip || location || s.Country__c || '',
            submitted,
            ageMin: mins,
            claimAgeMin: claimMins,
            claimedById: s.Claimed_By__c || null,
            junkReason: junkReasonOf(tagText),
            junkHasPrev: junkHasPrev(tagText),
            // v6g7: only means something while no Lead / Contact is linked
            unlinkedStatus: isUnlinked ? unlinkedStatusOf(tagText) : '',
            claimedByName: s.Claimed_By__r ? s.Claimed_By__r.Name : null,
            // "leadStatus" = Lead.Status, or Contact.Lead_Funnel_Status__c on a Contact-linked row.
            leadStatus: rec.status,
            leadOutcome: rec.outcome,
            ldrProject: lead.LDR_Project_Name__c || '',
            ldrNotes: lead.LDR_Notes__c || '',
            coordinatorId: rec.coordinatorId,
            coordinatorName: rec.coordinatorName,
            convertedAt,
            convertedAfter,
            contactAccountId: contact.AccountId || null,
            owner: lead.Owner ? lead.Owner.Name : contact.Owner ? contact.Owner.Name : 'Unassigned',
            outreach: lead.Outreach_Current_Sequence_Status__c,
            kbmaxCount: (recId && this.kbmaxCounts[recId]) || 0,
            // Estimates on this Lead/Contact OTHER than the row itself: an instant-estimate row is counted in
            // estimateCounts when its own Lead__c / Contact__c is the counted record, so "+1 Estimate" showed for
            // a person whose only estimate is the one being viewed.
            estimateCount: Math.max(
                0,
                ((recId && this.estimateCounts[recId]) || 0) -
                    (s.isEstimate && recId && (input.Lead__c === recId || input.Contact__c === recId) ? 1 : 0)
            ),
            matchedAccountId: lead.LeanData__Reporting_Matched_Account__c || null,
            // canvas a111: outbound prospects (price-range estimates, 3D configurator people), link safety-net tags
            isConfigurator: !!s.isConfigurator,
            isProspect: !!s.isConfigurator || (!!s.isEstimate && !!s.estimate && !!s.estimate.amount && s.estimate.amount !== 'Custom'),
            prospectList: s.isConfigurator ? 'configurator' : 'estimates',
            personId: s.personId || null,
            createdAt: s.CreatedDate,
            projectType: s.estimate ? s.estimate.classification : '',
            pr: s.pr || null,
            kb: s.kb || null,
            linkFixed: tagText.indexOf(LINK_FIXED_TAG) !== -1,
            linkFixedByEmail: tagText.indexOf(LINK_FIXED_TAG + '-email') !== -1,
            // "#LinkFixed-both" (had a Lead and a Contact: Lead removed); "#LinkFixed-converted" or the older plain tag on
            // a Contact-linked row (converted Lead: now points to its Contact).
            linkFixedBoth: tagText.indexOf(LINK_FIXED_TAG + '-both') !== -1,
            fixReviewed: tagText.indexOf(FIX_REVIEWED_TAG) !== -1,
            // #156: tags still in the old place (the one-time move hasn't reached this record)
            hasOldTags: OLD_TAG_RE.test(oldTags),
            raw: s
        };
    }

    /** this.rows = the queue plus the unclaimed prospects that aren't already in it (claimed ones come with the queue). */
    mergeRows() {
        const ids = new Set(this.queueRows.map((x) => x.id));
        this.rows = this.queueRows.concat(this.prospectRows.filter((x) => !ids.has(x.id)));
        this._evalCache = null;
    }

    /** Prospects tab data (read-only Apex). */
    async loadProspects() {
        this.prospectsLoading = true;
        this.prospectError = '';
        try {
            const r = await getProspectsApex();
            this.prospectSince = r.sinceLabel || '';
            this.prospectDays = r.prospectDays || null;
            this.configuratorClaimable = !!r.configuratorClaimable;
            this.prospectCapped = !!(r.estimatesCapped || r.configuratorCapped);
            this.prospectError = r.error || '';
            const counts = r.estimateCounts || {};
            const firsts = r.estimateFirstAt || {};
            const ests = (r.estimates || []).map((e) => {
                const lead = e.Lead__r || {};
                const n = normalizeEstimate(e);
                n.pr = {
                    wf: windfallLetter(lead.Windfall_Lead_Grade__c),
                    nw: Number(lead.wf_net_worth__c) || 0,
                    opt: !!(lead.DoNotCall || lead.HasOptedOutOfEmail),
                    hi: estimateHighEnd(e.Estimate_Amount__c),
                    n: counts[e.Lead__c] || 1,
                    firstAt: firsts[e.Lead__c] || ''
                };
                return this.mapRow(n);
            });
            const cfg = (r.configurator || []).map((p) => this.mapRow(this.configuratorSubmission(p)));
            this.prospectRows = ests.concat(cfg);
            this.prospectsLoaded = true;
            this.mergeRows();
        } catch (e) {
            this.prospectError = errorText(e);
        } finally {
            this.prospectsLoading = false;
        }
    }

    /**
     * A 3D configurator person as a submission-shaped row: one row per Lead / Contact, whose record is their latest
     * KBMax_Web_Quote__c (claimed rows: their latest claimed quote), so claim / save / release work on the quote.
     */
    configuratorSubmission(p) {
        const rec = p.rec || {};
        const isC = !!p.isContact;
        const phone = rec.Phone || rec.MobilePhone || '';
        return {
            Id: p.quoteId,
            Claimed_By__c: p.claimedById || null,
            Claimed_By__r: p.claimedById ? { Name: p.claimedByName } : null,
            ClaimedDate__c: p.claimedAt || null,
            Comments__c: p.comments || '',
            isConfigurator: true,
            personId: p.personId,
            CreatedDate: p.latestAt,
            Submit_Time__c: p.latestAt,
            LastModifiedDate: p.lastModifiedAt || null,
            Inquiry_Type__c: CONFIGURATOR,
            // #160: the latest quote's own Project Name, for the email subject only (not carried into the Lead's Project Name)
            cfgProjectName: p.latestProjectName || '',
            First_Name__c: rec.FirstName,
            Last_Name__c: rec.LastName,
            Company__c: isC ? (rec.Account && rec.Account.Name) || '' : rec.Company || '',
            Email_Address__c: rec.Email,
            Phone_Number__c: phone,
            Customer_Type__c: isC ? rec.LeadType__c : rec.Type__c,
            Zip_or_Postal_Code__c: isC ? rec.MailingPostalCode : rec.PostalCode,
            Lead__c: isC ? null : p.personId,
            Lead__r: isC ? null : rec,
            Contact__c: isC ? p.personId : null,
            Contact__r: isC ? rec : null,
            kb: {
                n: p.quotes || 0,
                n30: p.quotes30 || 0,
                max: Number(p.maxPrice) || 0,
                latest: p.latestAt,
                first: p.firstAt,
                recCreated: rec.CreatedDate,
                // Call list: only Do Not Call opts someone out (an email opt-out alone does not), 2026-10-14.
                opt: !!rec.DoNotCall,
                isContact: isC,
                model: p.latestModel || '',
                projectType: p.latestProjectType || '',
                hasRevit: !!p.hasRevit,
                hasIfc: !!p.hasIfc,
                hasDrawing: !!p.hasDrawing
            }
        };
    }

    /**
     * Link safety net (canvas a111, until the conversion fix is in): when the inbox loads, form submissions with both
     * a Lead and a Contact get the Lead link cleared, and ones on a converted Lead with no Contact point to its Contact.
     * Apex tags them "#LinkFixed" in the Comments field (#156: Comments1__c on form submissions, Comments__c on instant
     * estimates); admins review them from the notice. Each record is tried once per page session; failures
     * (e.g. no edit access) are only shown to admins. Apex re-checks every case, so a converted Lead only needs
     * IsConverted here (estimates don't carry ConvertedContactId in the queue query).
     */
    async runLinkFixes(submissions) {
        const ids = submissions
            .filter((f) => {
                const l = f.Lead__r || {};
                const fixable = f.Lead__c
                    ? !!(f.Contact__c || l.IsConverted)
                    : !f.Contact__c && !!f.Email_Address__c; // canvas 12d4: unlinked, try to link by email
                return fixable && !this.linkFixTried[f.Id];
            })
            .map((f) => f.Id)
            .slice(0, 200);
        if (!ids.length) return;
        const tried = { ...this.linkFixTried };
        ids.forEach((id) => {
            tried[id] = true;
        });
        this.linkFixTried = tried;
        try {
            const res = await fixLinksApex({ submissionIds: ids });
            this.linkFixError = res && res.failed ? res.failed + ' link fix(es) failed: ' + (res.firstError || '') : '';
            if (res && res.fixed) await this.load(true);
        } catch (e) {
            this.linkFixError = 'Link fixes failed: ' + errorText(e);
        }
    }

    /** Whose Mine / Finished / Team the tabs show: yourself, or (admins) the "View as" user. Writes are always you. */
    get viewerId() {
        return this.isAdmin && this.viewAsId && this.viewAsId !== BOSS_VIEW ? this.viewAsId : this.meId;
    }

    /** Boss View (admins): you as yourself, plus edit unclaimed records without claiming them. */
    get bossView() {
        return this.isAdmin && this.viewAsId === BOSS_VIEW;
    }

    /** Edit an unclaimed record without claiming: Boss View, or always for Aziz. (Apex allows both admins.) */
    get canEditUnclaimed() {
        return this.isAdmin && (this.bossView || ALWAYS_EDIT_UNCLAIMED_IDS.includes(this.meId));
    }

    get viewerName() {
        if (this.viewerId === this.meId) return this.meName;
        const r = this.rows.find((x) => x.claimedById === this.viewAsId);
        return r ? r.claimedByName : 'another LDR';
    }

    inTab(r, tab) {
        // Prospects (outbound) have their own tab: never in Unclaimed; gone from Prospects once claimed or passed.
        if (tab === 'prospects') return !!r.isProspect && !r.claimedById;
        if (tab === 'postquote') return false;
        if (r.isProspect && !r.claimedById) return false;
        const me = this.viewerId;
        // Marked as junk: done. Only in Finished, for the LDR who marked it, for FINISHED_DAYS days (canvas dd24, #149).
        if (r.junkReason) {
            const t = toTime(r.claimedAt) !== null ? toTime(r.claimedAt) : toTime(r.submitted);
            return tab === 'finished' && r.claimedById === me && t !== null && Date.now() - t <= FINISHED_DAYS * DAY_MS;
        }
        const mine = r.claimedById === me;
        // A submission with no Lead/Contact yet counts as still being worked, unless its status button said Unreachable /
        // Disqualified (v6g7: then it's finished, see isFinishedFor).
        const working = !r.isConverted && (r.isUnlinked ? !UNLINKED_DONE.includes(r.unlinkedStatus) : ACTIVE_STATUSES.includes(r.leadStatus));
        if (tab === 'finished') return this.isFinishedFor(r, me);
        // Canvas #108: All = every LDR's Mine + Finished: claimed and still being worked, or finished in the last
        // FINISHED_DAYS days by whoever claimed it (converted Contacts, Qualified, Nurture, ...). Junk stays out (above).
        if (tab === 'team') return !!r.claimedById && (working || this.isFinishedFor(r, r.claimedById));
        if (r.isConverted) return false;
        // Converted after the submission and already given a closing status: nothing left to work.
        if (tab === 'unclaimed') return !r.claimedById && !(r.convertedAfter && !['', ...ACTIVE_STATUSES].includes(r.leadStatus));
        // canvas #149: a converted Contact set back to New / Working is in Mine again (it isn't Finished then).
        if (tab === 'mine') return mine && working;
        return false;
    }

    /**
     * Finished for a given claimer (canvas #108 made this per claimer; Finished calls it with the viewer): claimed by
     * them and converted in the last FINISHED_DAYS days while not New / Working (#149), or no longer New/Working with
     * the later of the status change and the claim in the last FINISHED_DAYS days (canvas 9853: a record whose status
     * was already final never "changes").
     */
    isFinishedFor(r, claimer, days = FINISHED_DAYS) {
        if (!claimer || r.claimedById !== claimer || r.junkReason) return false;
        // v6g7: no Lead / Contact, set Unreachable / Disqualified: finished from that click (it restarts the claim time)
        if (r.isUnlinked) {
            const t = toTime(r.claimedAt);
            return UNLINKED_DONE.includes(r.unlinkedStatus) && t !== null && Date.now() - t <= days * DAY_MS;
        }
        const working = !r.isConverted && ACTIVE_STATUSES.includes(r.leadStatus);
        const convTime = r.isContactLinked ? toTime(r.convertedAt) : null;
        const recentlyConverted = convTime !== null && Date.now() - convTime <= days * DAY_MS;
        // Converted (Contact linked, or a row still on the converted Lead): Finished for FINISHED_DAYS days after the
        // conversion, unless an LDR set the Contact back to New / Working (then it's in Mine, #149).
        const leadConv = r.isConverted ? toTime(r.leadConvertedAt) : null;
        if ((recentlyConverted && !working) || (leadConv !== null && Date.now() - leadConv <= days * DAY_MS)) return true;
        const times = [toTime(r.statusChangedAt), toTime(r.claimedAt)].filter((t) => t !== null);
        return !working && times.length > 0 && Date.now() - Math.max(...times) <= days * DAY_MS;
    }

    /** The viewer's Finished rows from the last 7 days (the dashboard's "Finished this week"; the tab keeps FINISHED_DAYS). */
    finishedThisWeek(r) {
        if (!this.inTab(r, 'finished')) return false;
        if (!r.junkReason) return this.isFinishedFor(r, this.viewerId, WEEK_DAYS);
        const t = toTime(r.claimedAt) !== null ? toTime(r.claimedAt) : toTime(r.submitted);
        return t !== null && Date.now() - t <= WEEK_DAYS * DAY_MS;
    }

    /**
     * A status from an earlier cycle: claiming resets it to New (Apex does the same). Stale = Nurture / Wrong profile /
     * Unreachable / Bounced, or a value that isn't active in the field's picklist any more (Lead Status, Contact Lead
     * Funnel Status), e.g. "Inactive" or "Close - No Further Action".
     */
    isStaleStatus(r) {
        const st = r && r.leadStatus;
        if (!st || ACTIVE_STATUSES.includes(st) || DECIDED_STATUSES.includes(st)) return false;
        if (STALE_STATUSES.includes(st)) return true;
        const active = r.isContactLinked ? this.contactStatusValues : this.statusValues;
        return active.length > 0 && !active.includes(st);
    }

    /**
     * canvas #127: the inbox tab this record is in, from the same inTab() the lists use (so View as is respected).
     * Claimed by another LDR: their Mine / Finished, e.g. "Mine (Yasmin Hernandez)". Otherwise N/A.
     */
    currentTabLabel(r) {
        if (this.inTab(r, 'unclaimed')) return 'Unclaimed';
        if (this.inTab(r, 'prospects')) return 'Prospect';
        if (this.inTab(r, 'mine')) return 'Mine';
        if (this.inTab(r, 'finished')) return 'Finished';
        if (r.claimedById && r.claimedById !== this.viewerId && !r.junkReason && this.inTab(r, 'team')) {
            return (this.isFinishedFor(r, r.claimedById) ? 'Finished' : 'Mine') + ' (' + (r.claimedByName || 'another LDR') + ')';
        }
        return 'N/A';
    }

    /** canvas #143B: the tab this record is in (same tree as currentTabLabel), shown as a link when the list is elsewhere. */
    goTabFor(r) {
        const t = this.inTab(r, 'unclaimed') ? 'unclaimed'
            : this.inTab(r, 'prospects') ? 'prospects'
            : this.inTab(r, 'mine') ? 'mine'
            : this.inTab(r, 'finished') ? 'finished'
            : r.claimedById && r.claimedById !== this.viewerId && !r.junkReason && this.inTab(r, 'team') ? 'team' : null;
        const show = !!t && (t !== this.tab || (t === 'prospects' && r.prospectList !== this.prospectList));
        // #154: "Current Tab: <Tab> - Go to <Tab>" (no "Tab" at the end of the link)
        return { showGoTab: show, goTabLabel: show ? 'Go to ' + TAB_LABEL[t] : '', goTabKey: t || '', goTabList: t === 'prospects' ? r.prospectList : '' };
    }

    /** First inbox tab a queue row is in (canvas #143 order), or null. */
    homeTabOf(r) {
        return XT_HOME_TABS.find((k) => this.inTab(r, k)) || null;
    }

    /** Post Quote reply: open -> Post Quote; done in the last 7 days -> Finished (yours) / All; else null. */
    pqHomeTab(r) {
        if (!r.done) return 'postquote';
        if (r.doneAt === null || Date.now() - r.doneAt > PQ_DONE_DAYS * DAY_MS) return null;
        return r.coordinatorId === this.viewerId ? 'finished' : 'team';
    }

    /** The Post Quote filter that lists this reply. */
    pqFilterFor(r) {
        return r.coordinatorId === this.viewerId ? 'Mine' : r.coordinatorId ? 'All LDRs' : 'No Project Coordinator';
    }

    /**
     * Mine: no activity from the claimer for more than NO_OUTREACH_DAYS days since the later of claiming it,
     * setting it to Working, and their own last Task/Event on the record (owner or creator). New/Working only.
     */
    noOutreach(r, anyClaimer) {
        if (!r || !r.claimedById || (!anyClaimer && r.claimedById !== this.viewerId) || r.isUnlinked) return null;
        if (!ACTIVE_STATUSES.includes(r.leadStatus)) return null;
        const recId = r.leadId || r.contactId;
        const lastMine = toTime(this.lastActivityBy[recId + ':' + r.claimedById]);
        const times = [toTime(r.claimedAt), r.leadStatus === 'Working' ? toTime(r.statusChangedAt) : null, lastMine].filter(
            (t) => t !== null
        );
        if (!times.length) return null;
        const days = Math.floor((Date.now() - Math.max(...times)) / DAY_MS);
        if (days <= NO_OUTREACH_DAYS) return null;
        return {
            days,
            label: '⏱ No outreach ' + days + 'd',
            text:
                // v6f1 wording (Aqil)
                (lastMine !== null ? 'No activity from you in ' + days + ' days' : 'No activity from you in the ' + days + ' days since claiming') +
                '. Check Outreach sequence (if not enrolled add today).'
        };
    }

    /** Contact rows with open opportunities stay in the queue (decision 2026-10-06); this only flags them. */
    openOppInfo(r) {
        if (!r || !r.isContactLinked || !r.openOppCount) return null;
        const owners = r.openOppOwners;
        return {
            // v6g7 (Aqil): "Open opp" (was "Open opp · <rep>"); the rep is in the tag's tooltip and the card
            label: r.openOppCount === 1 ? 'Open opp' : r.openOppCount + ' open opps',
            owners
        };
    }




    // ------------------------------------------------------------ canvas 9fed: Windfall source, 6sense outcome

    /** Windfall fields for a row: the Lead's, or for a Contact its own / its converted Lead's (with __fromLead). */
    windfallSource(r) {
        if (r.isContactLinked) return this.contactWindfall[r.contactId] || {};
        return r.raw.Lead__r || {};
    }

    /** 6sense CE status / last synced / campaign for a row (queue: Follow Up fields; prospects: the record). */
    ceFields(r) {
        const f = r.followUp || {};
        if (f.sixsense_ce__status__c) return f;
        return r.raw.Lead__r || r.raw.Contact__r || {};
    }

    /** Card / detail view of a record's 6sense outcome. "Recent" = last synced within 90 days. */
    ceOutcome(r) {
        const c = this.ceFields(r);
        const status = c.sixsense_ce__status__c;
        if (!status || status === 'unsynced') return null;
        const L = CE_STATUS[status] || ['6sense: ' + status, '#707070', '#FFFFFF'];
        const t = toTime(c.sixsense_ce__last_synced_at__c);
        const days = t === null ? null : Math.floor((Date.now() - t) / DAY_MS);
        const syncedOn = t === null ? '' : new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: days > 300 ? 'numeric' : undefined });
        const dateNum = t === null ? '' : new Date(t).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric' });
        return { status, label: L[0], bg: L[1], fg: L[2], dateNum, when: syncedOn, days, recent: days !== null && days <= 90, campaign: c.sixsense_ce__campaign_name__c || '' };
    }

    /** "6Sense Activity" sentence for the detail (canvas 9fed). */
    ceSentence(o) {
        const camp = o.campaign ? '"' + o.campaign + '"' : 'a 6sense campaign';
        const on = o.when ? ' on ' + o.when : '';
        const ago = o.days === null ? '' : o.days <= 0 ? ' (today)' : o.days === 1 ? ' (yesterday)' : ' (' + o.days + ' days ago)';
        const T = {
            in_progress: 'In 6sense campaign ' + camp + ' right now, last synced' + on + ago + '; no outcome yet.',
            not_started: 'Added to 6sense campaign ' + camp + on + ago + '; the emails haven’t started yet.',
            qualified: 'Was in 6sense campaign ' + camp + ' and replied; 6sense marked them Qualified' + on + ago + '.',
            human_review: 'Was in 6sense campaign ' + camp + ' and replied; 6sense flagged the reply for Human review' + on + ago + ', so a person should follow up.',
            unresponsive: 'Was in 6sense campaign ' + camp + ' and didn’t reply; it ended as Unresponsive' + on + ago + '.',
            not_interested: 'Was in 6sense campaign ' + camp + ' and replied that they’re Not interested' + on + ago + '.',
            not_interested_now: 'Was in 6sense campaign ' + camp + ' and replied Not interested right now' + on + ago + '.',
            canceled: 'Was in 6sense campaign ' + camp + '; the campaign was Canceled for them' + on + ago + '.',
            bounced: 'Was added to 6sense campaign ' + camp + ' but the email Bounced' + on + ago + '.',
            enrollment_error: 'Couldn’t be enrolled in 6sense campaign ' + camp + ' (Enrollment error)' + on + ago + '.'
        };
        return (T[o.status] || '6sense status ' + o.status + on + ago + ' (' + camp + ').') + (o.recent ? '' : ' This was over 90 days ago.');
    }

    /** 6Sense Activity note + Sequence in Outreach for the detail panel. */
    get detailExtras() {
        const r = this.rows.find((x) => x.id === this.activeId);
        if (!r) return {};
        const o = this.ceOutcome(r);
        return {
            hasCeNote: !!o,
            ceNoteText: o ? this.ceSentence(o) : '',
            ceNoteTag: o ? o.label.replace(/^6sense: /, '') : '',
            ceNoteCls: 'ldr-ce-note',
            ceNoteStyle: o ? 'border-left-color:' + o.bg + ';' : '',
            ceNoteTagStyle: o ? 'background:' + o.bg + '; color:' + o.fg + ';' : ''
        };
    }

    // ------------------------------------------------------------ Prospects filters (canvas 9fed)

    get prospectCoordOptions() {
        const names = Array.from(new Set(this.rows.filter((r) => this.inTab(r, 'prospects')).map((r) => r.coordinatorName).filter(Boolean))).sort();
        return selectOptions(
            [{ value: 'All', label: 'Coordinator: All' }, { value: '__none', label: 'No coordinator' }, ...names.map((n) => ({ value: n, label: n }))],
            this.prospectCoordFilter
        );
    }

    handleProspectCoordFilter(e) {
        this.prospectCoordFilter = e.target.value || 'All';
    }

    /**
     * Prospects (canvas f123 / notes #89D): points still decide the section (strong / worth a call / everything else);
     * inside each section the cards are newest first by default, and the Date button flips newest / oldest. Sorting by
     * points is no longer offered.
     */
    toggleProspectSort() {
        this.toggleSortOrder();
    }

    get prospectSortTitle() {
        return this.sortTitle;
    }

    get prospectSortArrow() {
        return this.sortArrow;
    }

    // ------------------------------------------------------------ Outreach sequence buttons (canvas 55a9)

    /**
     * Active = current active sequence name set (when a finished sequence is ALSO set, only if
     * Outreach_Actively_being_Sequenced__c is checked); Finished = finished sequences set (and not active by that
     * rule); Unsequenced = neither.
     */
    sequenceState(r) {
        const f = r.followUp || {};
        const act = !!(f.Outreach_Current_Active_Sequence_Name__c || '').trim();
        const fin = !!(f.Outreach_Finished_Sequences__c || '').trim();
        const actively = f.Outreach_Actively_being_Sequenced__c === 'true';
        if (act && (!fin || actively)) return 'active';
        if (fin) return 'finished';
        return 'unseq';
    }

    get showSeqButtons() {
        return this.tab === 'mine' || this.tab === 'team';
    }

    /** #163: the Sequence Status dropdown (Mine, All; was a button bar), with each state's count in the tab. */
    get seqOptions() {
        const rows = this.rows.filter((r) => this.inTab(r, this.tab));
        return [
            ['all', 'Sequence Status: All'],
            ['active', 'Sequenced'],
            ['unseq', 'Unsequenced'],
            ['finished', 'Finished Sequence']
        ].map(([value, label]) => ({
            value,
            label: label + ' (' + (value === 'all' ? rows.length : rows.filter((r) => this.sequenceState(r) === value).length) + ')',
            selected: this.seqFilter === value
        }));
    }

    handleSeq(e) {
        this.seqFilter = e.target.value;
    }

    // ------------------------------------------------------------ My Dashboard (canvas 55a9, everyone but Boss View)

    /** User tabs (canvas #109 / #111): Inbox, Dashboard, Lead Views (Aqil / Aziz as themselves), Estimate (everyone). */
    get userTabs() {
        return [
            { key: 'inbox', label: 'LDR Inbox' },
            { key: 'dash', label: 'Dashboard' },
            ...(this.adminSelf ? [{ key: 'leadviews', label: 'Lead Views' }] : []),
            { key: 'estimate', label: 'Estimate' }
        ].map((t) => this.topTab(t, this.userTab === t.key));
    }

    /** canvas #135: a top-bar tab (button; the active one teal with the green underline and aria-current="page"). */
    topTab(t, on) {
        return { ...t, cls: 'ldr-top-tab' + (on ? ' ldr-top-tab-on' : ''), current: on ? 'page' : null };
    }

    get topTabs() {
        return this.bossView ? this.bossTabs : this.userTabs;
    }

    handleTopTab(e) {
        if (this.bossView) this.handleBossTab(e);
        else this.handleUserTab(e);
    }

    /** Estimate tab (canvas #111): every LDR, not in Boss View. */
    get isEstimateTab() {
        return !this.bossView && this.userTab === 'estimate';
    }

    /** Lead Views tab (canvas #109-113): the inbox admins (Aqil Bassa, Aziz Nana) as themselves, not in Boss View. */
    get isLeadViewsTab() {
        return !this.bossView && this.adminSelf && this.userTab === 'leadviews';
    }

    handleUserTab(e) {
        this.userTab = e.currentTarget.dataset.key;
        if (this.userTab === 'dash' && !this.prospectsLoaded && !this.prospectsLoading) this.loadProspects();
    }

    get isMyDash() {
        return !this.bossView && this.userTab === 'dash';
    }

    /** Suggested actions for My Dashboard, from what the inbox has loaded (the viewer's rows). */
    get myActions() {
        if (!this.isMyDash) return [];
        const me = this.viewerId;
        const ageTxt = (m) => (m >= 1440 ? Math.round(m / 1440) + 'd' : m >= 60 ? Math.round(m / 60) + 'h' : m + 'm');
        const mine = this.rows.filter((r) => r.claimedById === me);
        const groups = [];
        const add = (key, title, hint, dotCls, rows, toItem) => {
            if (rows.length) groups.push({ key, title, hint, dotCls, rows, toItem });
        };
        add('noout', 'No outreach in 5+ days', 'Claimed by you with no call or email logged lately. Check the Outreach sequence or reach out.', 'ldr-dot ldr-dot-red',
            mine.filter((r) => this.noOutreach(r)),
            (r) => ({ name: r.name, sub: (this.noOutreach(r) || {}).label || '', cta: 'Open', tab: 'mine' }));
        add('new', 'Claimed but still New', 'Update the Status once you have worked them.', 'ldr-dot ldr-dot-amber',
            mine.filter((r) => r.leadStatus === 'New' && !r.isProspect && this.inTab(r, 'mine')),
            (r) => ({ name: r.name, sub: r.form + ' · claimed', cta: 'Update', tab: 'mine' }));
        // canvas #139: for every LDR, after "Claimed but still New"
        add('pq', 'Post Quote replies for you', 'Replies to the post-quote emails routed to you as Project Coordinator.', 'ldr-dot ldr-dot-dark',
            this.pqOpenMine,
            (r) => ({ name: r.name, sub: r.projectName || '', cta: 'Review', tab: 'postquote' }));
        add('coord', 'Unclaimed, and you are the Project Coordinator', 'Probably yours from an earlier submission. Claim them so they are not missed.', 'ldr-dot ldr-dot-blue',
            this.rows.filter((r) => this.inTab(r, 'unclaimed') && r.coordinatorId === me),
            (r) => ({ name: r.name, sub: r.form + ' · waiting ' + ageTxt(r.ageMin || 0), cta: 'Claim', tab: 'unclaimed' }));
        add('oldest', 'Waiting longest in Unclaimed', 'Nobody has claimed these yet.', 'ldr-dot ldr-dot-grey',
            this.rows
                .filter((r) => this.inTab(r, 'unclaimed') && r.coordinatorId !== me)
                .sort((a, b) => (b.ageMin || 0) - (a.ageMin || 0))
                .slice(0, 3),
            (r) => ({ name: r.name, sub: r.form + ' · waiting ' + ageTxt(r.ageMin || 0), cta: 'Open', tab: 'unclaimed' }));
        const ev = this.prospectsLoaded ? this.prospectEvals : {};
        add('prospects', 'Prospects worth a call', 'Strongest outbound prospects right now (Instant estimates / 3D configurator).', 'ldr-dot ldr-dot-green',
            this.rows
                .filter((r) => this.inTab(r, 'prospects') && ev[r.id] && !ev[r.id].hidden && ev[r.id].tier === 'strong')
                .sort((a, b) => ev[b.id].pts - ev[a.id].pts)
                .slice(0, 3),
            (r) => ({
                name: r.name,
                sub: (r.isConfigurator ? '3D configurator' : 'Instant estimate') + ' · ' + ev[r.id].pts + ' pts',
                cta: 'Call',
                tab: 'prospects',
                prospectList: r.prospectList
            }));
        add('finished', 'Finished this week', 'Nice work. These moved past New / Working in the last 7 days.', 'ldr-dot ldr-dot-lime',
            mine.filter((r) => this.finishedThisWeek(r)),
            (r) => ({ name: r.name, sub: r.leadStatus || 'converted', cta: 'View', tab: 'finished' }));
        const out = [];
        groups.forEach((g) => {
            out.push({ key: 'h-' + g.key, isHeader: true, title: g.title, hint: g.hint, dotCls: g.dotCls, count: g.rows.length, counts: g.key !== 'finished' });
            g.rows.slice(0, 4).forEach((r) => out.push({ key: g.key + '-' + r.id, isItem: true, id: r.id, ...g.toItem(r) }));
        });
        return out;
    }

    /** My Dashboard: inbox numbers the dashboard shows. */
    get myInbox() {
        return { mineWorking: this.rows.filter((r) => this.inTab(r, 'mine')).length };
    }

    /** My Dashboard: open a suggested row in the inbox. */
    handleOpenRow(e) {
        const d = e.detail || {};
        this.userTab = 'inbox';
        if (d.tab) this.tab = d.tab;
        if (d.prospectList) this.prospectList = d.prospectList;
        this.seqFilter = 'all';
        if (d.id && isPqKey(d.id)) {
            this.activeId = d.id;
            this.saveView();
        } else if (d.id) {
            this.selectRow(d.id);
        }
    }

    // ------------------------------------------------------------ Prospects tab (canvas a111)

    /** Rules + score per unclaimed prospect row, cached until the rows change. */
    get prospectEvals() {
        if (this._evalCache && this._evalCache.rows === this.rows) return this._evalCache.map;
        const map = {};
        const now = Date.now();
        this.rows.forEach((r) => {
            if (!r.isProspect || r.claimedById) return;
            const pr = r.raw.Lead__r || r.raw.Contact__r || {};
            const route = r.isConfigurator
                ? resolveRepDisplay(this.routeInput(r, pr.State || pr.MailingState, pr.PostalCode || pr.MailingPostalCode))
                : null;
            map[r.id] = evaluateProspect(r, {
                now,
                repShown: route ? route.name || '' : '',
                nearest: r.isEstimate ? this.nearestFor(r) : null
            });
        });
        this._evalCache = { rows: this.rows, map };
        return map;
    }

    evaluateOne(r) {
        const pr = r.raw.Lead__r || r.raw.Contact__r || {};
        const route = r.isConfigurator
            ? resolveRepDisplay(this.routeInput(r, pr.State || pr.MailingState, pr.PostalCode || pr.MailingPostalCode))
            : null;
        return evaluateProspect(r, { now: Date.now(), repShown: route ? route.name || '' : '', nearest: r.isEstimate ? this.nearestFor(r) : null });
    }

    /** Strong + Worth a look (the tab and list-button counts). */
    prospectBestCount(listKey) {
        const ev = this.prospectEvals;
        return this.rows.filter(
            (r) => this.inTab(r, 'prospects') && (!listKey || r.prospectList === listKey) && ev[r.id] && !ev[r.id].hidden && ev[r.id].tier !== 'else'
        ).length;
    }

    get isProspectsTab() {
        return this.tab === 'prospects';
    }

    get isPostQuoteTab() {
        return this.tab === 'postquote';
    }

    get showStandardList() {
        return this.tab !== 'prospects' && !this.isBossAllSubs;
    }

    /** Record / Type / Status / coordinator / Form filters: not on Post Quote (it has its own filter in the tab bar). */
    get showQueueFilters() {
        return this.showStandardList && this.tab !== 'postquote';
    }

    get prospectLists() {
        return [
            ['estimates', 'Instant estimates'],
            ['configurator', '3D configurator']
        ].map(([key, label]) => ({
            key,
            label,
            count: this.prospectsLoaded ? this.prospectBestCount(key) : '·',
            cls: 'ldr-plist' + (this.prospectList === key ? ' ldr-plist-on' : '')
        }));
    }

    handleProspectList(e) {
        this.prospectList = e.currentTarget.dataset.key;
    }

    get showProspectError() {
        return !!this.prospectError;
    }

    /** The Prospects list: tier headers, cards, the "hidden by the rules" footer and (opened) the hidden rows. */
    get prospectItems() {
        if (this.tab !== 'prospects') return [];
        const ev = this.prospectEvals;
        const key = this.prospectList;
        const pool = this.rows.filter((r) => this.inProspectPool(r));
        const items = pool.map((r) => ({ r, e: ev[r.id] })).filter((x) => x.e);
        const shown = items.filter((x) => !x.e.hidden);
        const hid = items.filter((x) => x.e.hidden);
        const newest = this.sortOrder === 'newest';
        const byTier = (t) =>
            shown
                .filter((x) => x.e.tier === t)
                .sort((x, y) => (newest ? x.r.ageMin - y.r.ageMin : y.r.ageMin - x.r.ageMin));
        const strong = byTier('strong');
        const worth = byTier('worth');
        const rest = byTier('else');
        const out = [];
        const header = (tier, count, hint, toggle) =>
            out.push({
                key: 'hdr-' + tier,
                isHeader: true,
                label: TIER_LABEL[tier],
                count,
                hint,
                cls: 'ldr-tier-head ' + TIER_CLASS[tier],
                tier,
                hasToggle: !!toggle,
                toggleLabel: toggle || ''
            });
        const card = (x, tier) => {
            const r = x.r;
            const e = x.e;
            const k = r.kb || {};
            const where = [r.raw.Lead__r ? r.raw.Lead__r.City : '', r.raw.Lead__r ? r.raw.Lead__r.State : ''].filter(Boolean).join(', ');
            const whereC = r.raw.Contact__r ? [r.raw.Contact__r.MailingCity, r.raw.Contact__r.MailingState].filter(Boolean).join(', ') : '';
            const place = where || whereC;
            out.push({
                key: r.id,
                id: r.id,
                isCard: true,
                name: r.name,
                ageLabel: ageLabel(r.ageMin, r.submitted),
                subLine: r.isConfigurator ? [r.company, place].filter(Boolean).join(' · ') : place || r.raw.Zip_or_Postal_Code__c || '',
                summaryLine: r.isConfigurator
                    ? [k.n30 + (k.n30 === 1 ? ' quote' : ' quotes'), k.model, 'up to ' + shortMoney(k.max), 'latest ' + ageLabel(r.ageMin, r.submitted)]
                          .filter(Boolean)
                          .join(' · ')
                    : r.estimatePreview || '',
                chips: cardChips(e.chips).map((c, i) => ({ key: r.id + ':' + i, text: c.text, cls: CHIP_CLASS[c.kind] || CHIP_CLASS.info })),
                customerType: r.customerType || '',
                claimWord: r.isContactLinked ? 'Claim Contact' : 'Claim Lead',
                ...(() => {
                    const ce = this.ceOutcome(r);
                    return {
                        hasCe: !!ce,
                        ceLabel: ce ? ce.label : '',
                        ceCls: 'ldr-ce-line' + (ce && !ce.recent ? ' ldr-ce-old' : ''),
                        ceTagCls: 'ldr-ce-tag',
                        ceTagStyle: ce ? 'background:' + ce.bg + '; color:' + ce.fg + '; border-color:' + ce.bg + ';' : '',
                        ceSub: ce ? (ce.dateNum ? ce.dateNum + ' · ' : '') + '6Sense Status Updated' : ''
                    };
                })(),
                hasPhone: e.hasPhone,
                phoneShown: e.phoneShown,
                telHref: e.telHref,
                cls: 'ldr-pcard ' + TIER_CLASS[tier] + (r.id === this.activeId ? ' ldr-pcard-on' : ''),
                claimDisabled: this.busy || (r.isConfigurator && !this.configuratorClaimable),
                claimTitle: r.isConfigurator && !this.configuratorClaimable
                    ? 'Claiming 3D configurator prospects needs Claimed_By__c / ClaimedDate__c on KBMax_Web_Quote__c'
                    : 'Claim to call'
            });
        };
        if (strong.length) {
            header('strong', strong.length, 'Several signals line up (3 or more points).');
            strong.forEach((x) => card(x, 'strong'));
        }
        if (worth.length) {
            const all = !!this.prospectWorthAll[key];
            const capped = worth.length > PROSPECT_WORTH_CAP && !all;
            header(
                'worth',
                worth.length,
                capped ? 'One or two signals. Showing the top ' + PROSPECT_WORTH_CAP + ' by points.' : 'One or two signals.',
                worth.length > PROSPECT_WORTH_CAP ? (all ? 'Show Fewer' : 'Show All ' + worth.length) : ''
            );
            (capped ? worth.slice(0, PROSPECT_WORTH_CAP) : worth).forEach((x) => card(x, 'worth'));
        }
        if (rest.length) {
            const open = !!this.prospectElseOpen[key];
            header('else', rest.length, open ? 'No standout signal. Still callable, just lower odds.' : 'No standout signal yet. Kept out of the way.', open ? 'Hide' : 'Show ' + rest.length);
            if (open) rest.forEach((x) => card(x, 'else'));
        }
        const hc = {};
        hid.forEach((x) => {
            hc[x.e.hidden] = (hc[x.e.hidden] || 0) + 1;
        });
        const parts = Object.keys(hc)
            .sort((a, b) => hc[b] - hc[a])
            .map((k) => hc[k] + ' ' + HIDE_LABELS[k]);
        const hiddenOpen = !!this.prospectHiddenOpen[key];
        out.push({
            key: 'summary',
            isSummary: true,
            text: hid.length
                ? 'Hidden by the rules (' + hid.length + '): ' + parts.join(' · ') + '.'
                : 'Nothing hidden by the rules.',
            hasHidden: hid.length > 0,
            hiddenToggleLabel: hiddenOpen ? 'Hide Them' : 'Show Them',
            cappedNote: this.prospectCapped ? 'The list was capped (most recent records only).' : ''
        });
        if (hiddenOpen) {
            hid.forEach((x) =>
                out.push({ key: 'h-' + x.r.id, id: x.r.id, isHiddenRow: true, name: x.r.name, reason: HIDE_LABELS[x.e.hidden] })
            );
        }
        return out;
    }

    get prospectListEmpty() {
        return this.tab === 'prospects' && this.prospectsLoaded && !this.prospectItems.some((x) => x.isCard || x.isHiddenRow) &&
            !this.prospectItems.some((x) => x.isHeader);
    }

    handleProspectCard(e) {
        const id = e.currentTarget.dataset.id;
        if (id && id !== this.activeId) this.selectRow(id);
    }

    /** The card is role="button": Enter / Space open it like a click (keys on the phone link / Claim button inside are theirs). */
    handleProspectCardKey(e) {
        if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return;
        e.preventDefault();
        this.handleProspectCard(e);
    }

    handleTierToggle(e) {
        e.stopPropagation();
        const tier = e.currentTarget.dataset.tier;
        const key = this.prospectList;
        if (tier === 'worth') this.prospectWorthAll = { ...this.prospectWorthAll, [key]: !this.prospectWorthAll[key] };
        else if (tier === 'else') this.prospectElseOpen = { ...this.prospectElseOpen, [key]: !this.prospectElseOpen[key] };
    }

    toggleHiddenProspects() {
        const key = this.prospectList;
        this.prospectHiddenOpen = { ...this.prospectHiddenOpen, [key]: !this.prospectHiddenOpen[key] };
    }

    stopProp(e) {
        e.stopPropagation();
    }

    async claimProspect(e) {
        e.stopPropagation();
        const id = e.currentTarget.dataset.id;
        const row = this.rows.find((r) => r.id === id);
        if (!row || (row.isConfigurator && !this.configuratorClaimable)) return;
        if (this.activeId !== id) this.selectRow(id);
        await this.claim();
    }

    handleHiddenProspect(e) {
        const id = e.currentTarget.dataset.id;
        if (id) this.selectRow(id);
    }

    refreshProspects() {
        this.loadProspects();
    }

    // ------------------------------------------------------------ 3D configurator detail (canvas a111)

    async loadConfigDetail(r) {
        if (!r || !r.isConfigurator || this.cfgDetail[r.personId]) return;
        try {
            const quotes = await getConfiguratorDetailApex({ personId: r.personId });
            this.cfgDetail = { ...this.cfgDetail, [r.personId]: quotes || [] };
        } catch {
            this.cfgDetail = { ...this.cfgDetail, [r.personId]: [] };
        }
    }

    toggleCfgQuotes() {
        this.cfgQuotesAll = !this.cfgQuotesAll;
    }

    /** Prospect extras for the detail panel: why this one, and the configurator renders / quotes / files. */
    get prospectDetail() {
        const r = this.rows.find((x) => x.id === this.activeId);
        if (!r || !r.isProspect) return { isProspect: false };
        // Claimed prospects (now in Mine) keep their tier and reasons, like the canvas.
        const e = this.prospectEvals[r.id] || this.evaluateOne(r);
        const tier = e ? e.tier : 'else';
        const out = {
            isProspect: true,
            isOpenProspect: !r.claimedById && !!e,
            tierLabel: e ? (e.hidden ? 'Hidden by rules' : TIER_LABEL[tier]) : '',
            cardCls: 'ldr-card ldr-why-card ' + (e && !e.hidden ? TIER_CLASS[tier] : 'ldr-tier-else'),
            tierCls: 'ldr-tier-pill ' + (e && !e.hidden ? TIER_CLASS[tier] : 'ldr-tier-else'),
            hasHiddenNote: !!(e && e.hidden),
            hiddenNote: e && e.hidden ? 'Not on the list: ' + HIDE_LABELS[e.hidden] + '.' : '',
            why: e
                ? e.why.length
                    ? e.why.map((w, i) => ({ key: 'w' + i, text: w.text, points: '+' + w.points }))
                    : e.hidden
                      ? []
                      : [{ key: 'w0', text: 'No standout signal yet.', points: '0' }]
                : [],
            claimNote: r.isConfigurator && !this.configuratorClaimable
                ? 'Claiming 3D configurator prospects needs Claimed_By__c (Lookup User) and ClaimedDate__c on KBMax_Web_Quote__c. Until then, call from here and log the call on the Lead or Contact.'
                : 'Outbound: this person has not asked for a call. Claiming sets you as the coordinator and moves them to Mine, tagged Outbound.',
            isConfigurator: !!r.isConfigurator
        };
        if (!r.isConfigurator) return out;
        const quotes = this.cfgDetail[r.personId];
        out.cfgLoading = quotes === undefined;
        out.hasCfg = !!quotes && quotes.length > 0;
        out.noCfg = !!quotes && quotes.length === 0;
        if (!out.hasCfg) return out;
        const q0 = quotes[0];
        const dollars = (v) => (v === null || v === undefined ? '—' : '$' + Math.round(v).toLocaleString());
        const shortDay = (d) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        const previews = [];
        if (q0.renderUrl) previews.push({ key: 'main', label: 'Main render', sub: 'Render_File_URL__c', url: q0.renderUrl, hasImage: true });
        const posFields = (q0.positionImageIds || []).filter(Boolean);
        if (posFields.length) {
            posFields.forEach((id, i) =>
                previews.push({ key: 'pos' + i, label: 'Position render ' + (i + 1), sub: 'File ' + id, url: '', hasImage: false })
            );
        } else {
            parsePositions(q0.positions).forEach(([label, id], i) =>
                previews.push({ key: 'pos' + i, label, sub: 'File ' + id, url: '', hasImage: false })
            );
        }
        out.previews = previews.map((x, i) => ({ ...x, index: i }));
        out.hasPreviews = previews.length > 0;
        out.facts = [
            { k: 'Model', v: q0.model || '—' },
            { k: 'Product line', v: q0.productType || '—' },
            { k: 'Project', v: q0.project || '—' },
            { k: 'Quote price', v: dollars(q0.price) },
            { k: 'KBMax quote ID', v: q0.kbQuoteId || '—' },
            { k: 'Built', v: new Date(q0.createdAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) },
            { k: 'Quote status', v: q0.status || '—' },
            { k: 'Quote emailed to them', v: q0.sent ? 'Yes' : 'No' },
            { k: 'Quotes in 30 days', v: String((r.kb || {}).n30 || 0) }
        ];
        out.quotesTitle = 'Quotes they built (' + quotes.length + ')';
        out.hasMoreQuotes = quotes.length > CFG_QUOTES_SHOWN;
        out.quotesToggleLabel = this.cfgQuotesAll ? 'Show Fewer' : 'Show All ' + quotes.length;
        out.quotes = (this.cfgQuotesAll ? quotes : quotes.slice(0, CFG_QUOTES_SHOWN)).map((x) => ({
            key: x.id,
            when: shortDay(x.createdAt),
            model: x.model || '—',
            project: x.project || '',
            price: dollars(x.price)
        }));
        const tileCls = (t) => 'ldr-file-tile' + (t === 'PDF' ? ' ldr-file-tile-pdf' : t === 'LINK' ? ' ldr-file-tile-link' : '');
        const file = (key, label, hint, url, tile) => ({
            key, isFile: true, label, hint, url: url || '', has: !!url, noLink: !url, noLinkText: 'Not on this quote', tile, tileCls: tileCls(tile)
        });
        out.files = [
            { key: 'g1', isGroup: true, label: 'Likely requested (only on some quotes)' },
            file('rfa', 'Revit file, exact (RFA)', 'on 45% of recent quotes', q0.rfaUrl, 'RFA'),
            file('ifc', 'Revit IFC', 'on 8%', q0.ifcUrl, 'IFC'),
            file('dwg', 'Drawing (PDF)', 'on 13%', q0.drawingUrl, 'PDF'),
            file('cad', 'CAD PDF', 'on 13%', q0.cadPdfUrl, 'PDF'),
            { key: 'g2', isGroup: true, label: 'On nearly every quote' },
            file('spec', 'Specification', '', q0.specUrl, 'PDF'),
            file('zip', 'Drawing files (zip)', 'on 82%', q0.zipUrl, 'ZIP'),
            file('saved', 'Saved project in the 3D Configurator', 'reopens their configuration', q0.savedProjectUrl, 'LINK')
        ];
        if (q0.sceneVideoId) {
            out.files.push({ key: 'video', isFile: true, label: 'Scene animation (video)', hint: 'file ' + q0.sceneVideoId, url: '', has: false, noLink: true,
                noLinkText: 'No link in Salesforce yet', tile: 'MP4', tileCls: tileCls('MP4') });
        }
        return out;
    }

    openCfgPreview(e) {
        const i = Number(e.currentTarget.dataset.index);
        this.lightboxIndex = Number.isNaN(i) ? null : i;
    }

    // ------------------------------------------------------------ form filter (canvas a111)

    get formFilterOptions() {
        const src = this.isBossAllSubs ? this.allSubsBase : this.rows.filter((r) => this.inTab(r, this.tab));
        const forms = Array.from(new Set(src.map((r) => r.form).filter(Boolean))).sort();
        return selectOptions([{ value: 'All', label: 'Form: All' }, ...forms.map((f) => ({ value: f, label: f }))], this.formFilter);
    }

    handleFormFilter(e) {
        this.formFilter = e.target.value || 'All';
    }

    // ------------------------------------------------------------ Boss View: Inbox / All Submissions / Dashboard

    get bossTabs() {
        return BOSS_TABS.map((t) => this.topTab(t, this.bossTab === t.key));
    }

    handleBossTab(e) {
        this.bossTab = e.currentTarget.dataset.key;
        // Leaving the Inbox boss tab from Post Quote goes back to Unclaimed (canvas bossTabs.pick).
        if (this.bossTab !== 'inbox' && this.tab === 'postquote') {
            this.tab = 'unclaimed';
            const first = this.firstQueueItem();
            if (first) this.selectRow(first.id);
        }
        if (this.bossTab === 'allsubs' && !this.allSubs.length) this.loadAllSubs();
        // Status and Type options differ between the inbox tabs and All Submissions, so reset them (as handleTab does).
        this.statusFilter = 'All';
        this.recTypeFilter = 'All';
    }

    /** canvas #148: the list search is only on Prospects and Post Quote; elsewhere a leftover search is ignored. */
    get showListSearch() {
        return SEARCH_TABS.includes(this.tab) && !this.isBossAllSubs;
    }

    /** The list search text, or '' on a tab without the search box. */
    get listQuery() {
        return SEARCH_TABS.includes(this.tab) ? this.searchQuery.trim() : '';
    }

    get isBossAllSubs() {
        return this.bossView && this.bossTab === 'allsubs';
    }

    get isBossSix() {
        return this.bossView && this.bossTab === 'six';
    }

    get isBossDash() {
        return this.bossView && this.bossTab === 'dash';
    }

    get appVersion() {
        return APP_VERSION;
    }

    /** The Finished window, for the junk banner ("It stays in Finished for N days"). */
    get finishedDays() {
        return FINISHED_DAYS;
    }

    /** Boss View > Claim Audit (canvas #145B). */
    get isBossAudit() {
        return this.bossView && this.bossTab === 'audit';
    }

    /** The tab row: inbox tabs, or (Boss View > All Submissions, notes #89C) the date filters and stats line. */
    get showInboxTabs() {
        return !(this.bossView && ['dash', 'six', 'audit'].includes(this.bossTab)) && !this.isMyDash && !this.isEstimateTab && !this.isLeadViewsTab;
    }

    allSubsDates() {
        const now = Date.now();
        if (this.allSubsRange === 'custom') {
            return { from: this.allSubsFrom || isoDay(now - 365 * DAY_MS), to: this.allSubsTo || isoDay(now) };
        }
        return { from: isoDay(now - Number(this.allSubsRange) * DAY_MS), to: isoDay(now) };
    }

    async loadAllSubs() {
        // Only the latest request may update the list (e.g. "Past year" then "Past 7 days": the slower year reply
        // used to land last and show under the 7-day label).
        const seq = ++this._allSubsSeq;
        this.allSubsLoading = true;
        this.allSubsError = '';
        try {
            const d = this.allSubsDates();
            const res = (await getAllSubmissionsApex({ fromDate: d.from, toDate: d.to })) || [];
            if (seq === this._allSubsSeq) this.allSubs = res;
        } catch (e) {
            if (seq !== this._allSubsSeq) return;
            this.allSubsError = errorText(e);
            this.allSubs = [];
        } finally {
            if (seq === this._allSubsSeq) this.allSubsLoading = false;
        }
    }

    get allSubsPresets() {
        return ALL_SUBS_PRESETS.map((p) => ({ ...p, cls: 'ldr-preset' + (this.allSubsRange === p.key ? ' ldr-preset-on' : '') }));
    }

    handleAllSubsPreset(e) {
        this.allSubsRange = e.currentTarget.dataset.key;
        this.loadAllSubs();
    }

    handleAllSubsFrom(e) {
        this.allSubsRange = 'custom';
        this.allSubsFrom = e.target.value;
        this.loadAllSubs();
    }

    handleAllSubsTo(e) {
        this.allSubsRange = 'custom';
        this.allSubsTo = e.target.value;
        this.loadAllSubs();
    }

    /** All Submissions rows as loaded (date range only), in the shape the filters and the list use. */
    get allSubsBase() {
        if (!this.isBossAllSubs) return [];
        return this.allSubs.map((x) => {
            const lead = x.Lead__r || {};
            const con = x.Contact__r || {};
            const isEst = String(x.Id).startsWith(this.estimatePrefix);
            const form = isEst ? INSTANT_ESTIMATE : x.Type__c || x.Inquiry_Type__c || 'Form';
            const claimed = x.Claimed_By__r ? x.Claimed_By__r.Name : '';
            const coord = (x.Contact__c ? con.Project_Coordinator__r : lead.Project_Coordinator__r) || {};
            const status = (x.Contact__c ? con.Lead_Funnel_Status__c : lead.Status) || '';
            const at = x.Submit_Time__c || x.CreatedDate;
            const record = x.Contact__c ? 'Contact' : x.Lead__c ? 'Lead' : 'None yet';
            return {
                key: x.Id,
                id: x.Id,
                t: new Date(at).getTime(),
                date: new Date(at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
                name: [x.First_Name__c, x.Last_Name__c].filter(Boolean).join(' ') || '(no name)',
                email: x.Email_Address__c || '',
                formCls: inquiryCls(form),
                form,
                customerType: x.Customer_Type__c || '—',
                record,
                recordKind: record === 'None yet' ? 'No record yet' : record,
                recordType: (x.Contact__c ? con.LeadType__c : lead.Type__c) || '',
                status,
                coordinatorName: coord.Name || '',
                claimTag: claimed ? 'Claimed: ' + claimed : 'Unclaimed',
                claimCls: 'ldr-tag ' + (claimed ? 'ldr-tag-claimed' : 'ldr-tag-unclaimed'),
                coordTag: 'Coordinator: ' + (coord.Name || 'none'),
                statusTag: 'Status: ' + (status || 'blank'),
                cls: 'ldr-allsub ldr-allsub-' + ({ Contractor: 'contractor', Architect: 'architect', 'Business Owner': 'business', Homeowner: 'homeowner' }[x.Customer_Type__c] || 'other') + (x.Id === this.activeId ? ' ldr-allsub-on' : ''),
                claimed: !!claimed
            };
        });
    }

    /**
     * Boss View > All Submissions (canvas f123 / notes #89C, #90): the same Record / Type / Status / Form filters,
     * search and Date sort as the inbox, plus its own Project Coordinator filter. The stats line under the dates
     * follows every filter: "[period] · N total · N claimed · N unclaimed · New · Working · Qualified · Nurture ·
     * other statuses A–Z · Without Status" (only statuses with rows).
     */
    get allSubsView() {
        const d = this.allSubsDates();
        const q = this.searchQuery.trim().toLowerCase();
        const cf = this.allSubsCoordFilter;
        const rows = this.allSubsBase
            .filter((r) => this.recordFilter === 'All' || r.recordKind === this.recordFilter)
            .filter((r) => this.recTypeFilter === 'All' || r.recordType === this.recTypeFilter)
            .filter((r) => this.statusFilter === 'All' || (r.status || '(blank)') === this.statusFilter)
            .filter((r) => this.formFilter === 'All' || r.form === this.formFilter)
            .filter((r) => cf === 'All' || (cf === '__none' ? !r.coordinatorName : r.coordinatorName === cf))
            .filter((r) => !q || r.name.toLowerCase().includes(q) || r.email.toLowerCase().includes(q))
            .sort((a, b) => (this.sortOrder === 'oldest' ? a.t - b.t : b.t - a.t));
        const claimed = rows.filter((r) => r.claimed).length;
        const cnt = {};
        rows.forEach((r) => {
            cnt[r.status] = (cnt[r.status] || 0) + 1;
        });
        const first = ['New', 'Working', 'Qualified', 'Nurture'];
        const keys = first
            .filter((k) => cnt[k])
            .concat(Object.keys(cnt).filter((k) => k && !first.includes(k)).sort());
        if (cnt['']) keys.push('');
        const periodLabel = this.allSubsRange === 'custom'
            ? d.from + ' to ' + d.to
            : (ALL_SUBS_PRESETS.find((p) => p.key === this.allSubsRange) || {}).label || '';
        return {
            rows,
            empty: !this.allSubsLoading && rows.length === 0,
            periodLabel,
            total: rows.length,
            claimed,
            unclaimed: rows.length - claimed,
            statusParts: keys.map((k) => ({ key: k || '__blank', label: k || 'Without Status', count: cnt[k] })),
            from: d.from,
            to: d.to
        };
    }

    /** All Submissions' Project Coordinator filter: All / No Project Coordinator / each coordinator (notes #90). */
    get allSubsCoordOptions() {
        const names = Array.from(new Set(this.allSubsBase.map((r) => r.coordinatorName).filter(Boolean))).sort();
        return selectOptions(
            [
                { value: 'All', label: 'Project Coordinator: All' },
                { value: '__none', label: 'No Project Coordinator' },
                ...names.map((n) => ({ value: n, label: n }))
            ],
            this.allSubsCoordFilter
        );
    }

    handleAllSubsCoordFilter(e) {
        this.allSubsCoordFilter = e.target.value || 'All';
    }

    get estimatePrefix() {
        const est = this.rows.find((r) => r.isEstimate);
        return est ? String(est.id).slice(0, 3) : '___';
    }

    /** All Submissions row: open it in the inbox when it is loaded there, otherwise in Salesforce. */
    handleAllSub(e) {
        const id = e.currentTarget.dataset.id;
        if (this.rows.find((r) => r.id === id)) {
            this.selectRow(id);
            return;
        }
        this.openRecord(id, String(id).startsWith(this.estimatePrefix) ? 'Website_Instant_Estimate__c' : 'Form_Submission__c');
    }

    /** "From the inbox" rows for the dashboard, from what the inbox has loaded. */
    get dashboardInbox() {
        const by = {};
        this.queueRows.forEach((r) => {
            const add = (name, k) => {
                if (!name) return;
                by[name] = by[name] || { name, working: 0, finished: 0, noOut: 0, unclaimedCoord: 0, outbound: 0 };
                by[name][k] += 1;
            };
            if (r.claimedById) {
                const working = !r.isConverted && (r.isUnlinked || ACTIVE_STATUSES.includes(r.leadStatus));
                if (working) add(r.claimedByName, 'working');
                const t = toTime(r.statusChangedAt);
                if (!working && t !== null && Date.now() - t <= WEEK_DAYS * DAY_MS) add(r.claimedByName, 'finished');
                if (r.isProspect) add(r.claimedByName, 'outbound');
                if (this.noOutreach(r, true)) add(r.claimedByName, 'noOut');
            } else if (r.coordinatorName) {
                add(r.coordinatorName, 'unclaimedCoord');
            }
        });
        const unclaimed = this.queueRows.filter((r) => !r.claimedById && !r.isProspect);
        const oldest = unclaimed.reduce((m, r) => Math.max(m, r.ageMin || 0), 0);
        return {
            rows: Object.values(by),
            unclaimedNow: unclaimed.length,
            oldestWaiting: oldest >= 1440 ? Math.round(oldest / 1440) + ' days' : Math.round(oldest / 60) + ' hours'
        };
    }

    // ------------------------------------------------------------ link safety net notice (admins)

    /** Rows the safety net may have tagged: the queue plus loaded prospect estimates (mergeRows deduplicates). */
    get relinkSource() {
        return this.rows || this.queueRows;
    }

    get relinkRows() {
        return this.relinkSource
            .filter((r) => r.linkFixed && !r.fixReviewed && !r.isConfigurator)
            .map((r) => ({
                key: r.id,
                id: r.id,
                name: r.name,
                form: r.form,
                formCls: inquiryCls(r.form),
                what: r.linkFixedByEmail
                    ? 'No Lead or Contact: linked by email to ' + (r.isContactLinked ? 'Contact ' : 'Lead ') +
                      (((r.isContactLinked ? r.raw.Contact__r : r.raw.Lead__r) || {}).Name || '')
                    : r.linkFixedBoth
                      ? 'Had a Lead and a Contact: Lead removed'
                      : 'Converted Lead: now points to its Contact',
                where: (() => {
                    const t = this.relinkTabOf(r);
                    const label = t ? (TABS.find((x) => x.key === t) || {}).label : '';
                    return (label ? 'in ' + label : 'not in a tab') + (r.claimedByName ? ' · claimed by ' + r.claimedByName : '');
                })(),
                isEstimate: !!r.isEstimate,
                field: 'Comments' // #156: Comments1__c on a form submission, Comments__c on an instant estimate
            }));
    }

    relinkTabOf(r) {
        return ['unclaimed', 'mine', 'finished', 'team', 'prospects'].find((k) => this.inTab(r, k)) || null;
    }

    get showRelinkNotice() {
        return this.adminSelf && !this.relinkNoticeDismissed && this.relinkRows.length > 0;
    }

    get relinkCount() {
        return this.relinkRows.length;
    }

    /** "3 linked by email; 2 Lead links fixed" for the notice. */
    get relinkDetail() {
        const rows = this.relinkSource.filter((r) => r.linkFixed && !r.fixReviewed && !r.isConfigurator);
        const byEmail = rows.filter((r) => r.linkFixedByEmail).length;
        const both = rows.filter((r) => !r.linkFixedByEmail && r.linkFixedBoth).length;
        const converted = rows.length - byEmail - both;
        return [
            byEmail ? byEmail + ' with no Lead or Contact ' + (byEmail === 1 ? 'was' : 'were') + ' linked to the existing record with the same email' : '',
            converted ? converted + ' on a converted Lead now point to its Contact' : '',
            both ? both + ' that had both a Lead and a Contact had the Lead removed' : ''
        ]
            .filter(Boolean)
            .join('; ');
    }

    get relinkHasRows() {
        return this.relinkRows.length > 0;
    }

    /** Clear All (canvas 12d4): "#FixReviewed" on every submission still on the list. */
    async clearAllRelinks() {
        const ids = this.relinkRows.map((r) => r.id);
        if (!ids.length) return;
        await this.run(async () => {
            const n = await markFixesReviewedApex({ submissionIds: ids });
            this.message = 'Marked all ' + n + ' as reviewed: "#FixReviewed" added to Comments on each.';
        });
    }

    get showLinkFixError() {
        return this.adminSelf && !!this.linkFixError;
    }

    dismissRelinkNotice() {
        this.relinkNoticeDismissed = true;
    }

    openRelinkList() {
        this.relinkListOpen = true;
    }

    closeRelinkList() {
        this.relinkListOpen = false;
    }

    get showRelinkList() {
        return this.adminSelf && this.relinkListOpen;
    }

    get relinkListEmpty() {
        return this.relinkRows.length === 0;
    }

    openRelinkRow(e) {
        const id = e.currentTarget.dataset.id;
        const row = this.rows.find((r) => r.id === id);
        this.relinkListOpen = false;
        if (!row) return;
        const t = this.relinkTabOf(row);
        if (t) this.tab = t;
        if (t === 'prospects' && !this.prospectsLoaded && !this.prospectsLoading) this.loadProspects();
        this.selectRow(id);
    }

    // ------------------------------------------------------------ #146: claimed Leads / Contacts with no email after 24h

    /** Read-only Apex; on an error the notice just stays hidden (it's a nudge, not a blocker). */
    async loadUncontacted() {
        const seq = ++this._uncSeq;
        try {
            const r = await getUncontactedClaimsApex({ userId: this.viewerId || null });
            if (seq === this._uncSeq) this.uncontacted = r || [];
        } catch {
            if (seq === this._uncSeq) this.uncontacted = [];
        }
    }

    get uncontactedCount() {
        return this.uncontacted.length;
    }

    get showUncontacted() {
        return this.uncontacted.length > 0;
    }

    get uncontactedNoun() {
        return this.uncontacted.length === 1 ? 'claimed Lead or Contact' : 'claimed Leads or Contacts';
    }

    get uncontactedRows() {
        const now = Date.now();
        return this.uncontacted.map((u) => {
            const row = this.rows.find((r) => r.id === u.submissionId);
            const t = row ? this.homeTabOf(row) : null;
            const days = Math.max(0, Math.floor((now - new Date(u.claimedAt).getTime()) / DAY_MS));
            return {
                key: u.personId,
                id: u.submissionId,
                personId: u.personId,
                kind: u.personType,
                name: u.name || '(no name)',
                form: formName(u.form),
                formCls: inquiryCls(formName(u.form)),
                cls: 'ldr-relink-row ldr-unc-row ' + (TYPE_CLASS[u.customerType] || 'ldr-type-unknown'),
                sub: 'Claimed ' + claimTimeLabel(u.claimedAt) +
                    ' (' + days + (days === 1 ? ' day ago' : ' days ago') + ') · ' + (t ? 'in ' + TAB_LABEL[t] : 'not in a tab') +
                    ' · Status: ' + (u.status || '(blank)')
            };
        });
    }

    get uncontactedListEmpty() {
        return this.uncontacted.length === 0;
    }

    openUncontacted() {
        this.uncontactedOpen = true;
    }

    closeUncontacted() {
        this.uncontactedOpen = false;
    }

    /** × only on your own list (View as another LDR is read-only here; Apex checks too). */
    get canAckUncontacted() {
        return !this.viewingAsOther;
    }

    /**
     * Name: open it in its tab (as #143), on the current tab when it's in none. Not loaded (#148: shouldn't happen now
     * that claimed estimates load like forms): a toast, and the list stays open.
     */
    openUncontactedRow(e) {
        const id = e.currentTarget.dataset.id;
        const row = this.rows.find((r) => r.id === id);
        if (!row) {
            this.dispatchEvent(
                new ShowToastEvent({
                    title: 'LDR Inbox',
                    variant: 'warning',
                    message: 'This submission isn’t loaded in the inbox. Press ↻ to reload, or use Search Salesforce to find the person.'
                })
            );
            return;
        }
        this.uncontactedOpen = false;
        const t = this.homeTabOf(row);
        if (t) {
            this.jumpTo(t, id, t === 'prospects' ? { prospectList: row.prospectList } : null);
        } else {
            this.userTab = 'inbox';
            if (this.bossView) this.bossTab = 'inbox';
            this.selectRow(id);
        }
    }

    /** ×: "#NoContactNeeded" on each of the person's claimed submissions; they leave the list and the notice. */
    async ackUncontacted(e) {
        const personId = e.currentTarget.dataset.person;
        const u = this.uncontacted.find((x) => x.personId === personId);
        if (!u) return;
        await this.run(async () => {
            const n = await markNoContactNeededApex({ submissionIds: u.submissionIds });
            this.message = 'Email not needed: "#NoContactNeeded" added to Comments on ' + (u.name || 'this person') +
                '’s ' + (n > 1 ? n + ' submissions' : u.isEstimate ? 'instant estimate' : 'form submission') + '.';
            this.uncontacted = this.uncontacted.filter((x) => x.personId !== personId);
        });
    }

    // ------------------------------------------------------------ #156: one-time move (built in, admins)

    /** Loaded rows whose tags are still in the old field. */
    get legacyTagRows() {
        return this.rows.filter((r) => r.hasOldTags).length;
    }

    /** Admins (as themselves / Boss View), only while something is left; gone once the move has run and reloaded. */
    get showLegacyMove() {
        return this.adminSelf && !this.loading && (this.legacyClaimDates || this.legacyTagRows > 0);
    }

    get legacyMoveText() {
        const n = this.legacyTagRows;
        return [
            n ? n + ' loaded submission' + (n === 1 ? ' has' : 's have') + ' tags in the old Comments / Questions or Comments field' : '',
            this.legacyClaimDates ? 'some claims have a Claimed Date but no claim time' : ''
        ]
            .filter(Boolean)
            .join('; ') + '. Move Now copies them to the new fields (all records, not only the loaded ones).';
    }

    /** Runs LdrInboxController.moveLegacyFields once, then reloads (the notice goes away when nothing is left). */
    async runLegacyMove() {
        await this.run(async () => {
            const r = await moveLegacyFieldsApex();
            this.dispatchEvent(
                new ShowToastEvent({
                    title: 'One-time move',
                    variant: r.failed ? 'warning' : 'success',
                    mode: r.failed ? 'sticky' : 'dismissible',
                    message:
                        'Tags moved on ' + r.tagsMoved + ' record(s); claim times filled on ' + r.claimTimesFilled + '.' +
                        (r.skipped ? ' ' + r.skipped + ' left as they are (the Comments field would pass 255 characters).' : '') +
                        (r.failed ? ' ' + r.failed + ' failed: ' + (r.firstError || 'unknown error') + '.' : '')
                })
            );
        });
    }

    async ackRelink(e) {
        const id = e.currentTarget.dataset.id;
        const row = this.relinkRows.find((r) => r.id === id) || {};
        await this.run(async () => {
            await markFixReviewedApex({ submissionId: id });
            this.message = 'Marked reviewed: "#FixReviewed" added to Comments on ' + (row.name || 'the') + '\u2019s ' +
                (row.isEstimate ? 'instant estimate.' : 'form submission.');
        });
    }

    // ------------------------------------------------------------ Post Quote (canvas #139-#142)
    // The inbox owns the replies and their cards (Post Quote tab, and the done ones at the end of Finished / All);
    // c-ldr-post-quote is the detail page for the selected reply and asks for a reload after it saves or marks.

    async loadPostQuote() {
        const seq = ++this._pqSeq;
        this.pqLoading = true;
        try {
            const r = await getPostQuoteApex();
            if (seq !== this._pqSeq) return;
            this.pqError = r.error || '';
            this.pqSince = r.sinceLabel || '';
            this.pqPicklists = { proj: r.projStageOptions || [], reason: r.reasonOptions || [], lostTo: r.lostToOptions || [], opp: r.oppStageOptions || [] };
            this.pqRows = (r.rows || []).map((x) => this.mapPostQuoteRow(x));
            this.pqLoaded = true;
            if (this.tab === 'postquote' && !this.pqActive) this.selectFirstPq();
        } catch (e) {
            if (seq === this._pqSeq) this.pqError = errorText(e);
        } finally {
            if (seq === this._pqSeq) this.pqLoading = false;
        }
    }

    /** One Contact + project; the latest email decides whether it's done (its Comments end with an Action taken tag). */
    mapPostQuoteRow(x) {
        const emails = (x.emails || []).slice().sort((a, b) => new Date(b.at) - new Date(a.at));
        const latest = emails[0] || {};
        const seg = (x.campaign || '').match(/6S\.4\.EV\.([A-Z]+)\.([A-Z]+)_/) || [];
        const segType = PQ_SEGMENT_TYPE[seg[1]] || '';
        // Rep = the matched Opportunity's owner through the owner aliases only (#141); the Contact owner when no
        // Opportunity matched (decision to confirm).
        const rep = aliasOwner(x.oppOwner || x.owner);
        const projOwner = aliasOwner(x.projectOwner);
        const done = latest.doneTag ? { tag: latest.doneTag, at: latest.modifiedAt, by: latest.modifiedBy } : null;
        const key = 'PQ-' + x.contactId + '-' + (x.projectId || x.projectName || '');
        return {
            ...x,
            key,
            id: key,
            emails,
            latest,
            others: emails.slice(1),
            latestAt: latest.at || null,
            segType,
            segKind: PQ_SEGMENT_KIND[seg[2]] || '',
            customerType: segType || 'Unknown',
            rep,
            projectOwnerShown: projOwner,
            isSplit: !!(x.oppOwner && projOwner && projOwner !== rep),
            done,
            doneAt: done ? toTime(done.at) : null
        };
    }

    get pqOpen() {
        return this.pqRows.filter((r) => !r.done);
    }

    /** Open replies routed to the viewer (Project Coordinator): the Post Quote tab count. */
    get pqOpenMine() {
        return this.pqOpen.filter((r) => r.coordinatorId === this.viewerId);
    }

    /** Marked done in the last PQ_DONE_DAYS days (All); pqFinishedMine = the viewer's (Finished). */
    get pqDoneRecent() {
        return this.pqRows.filter((r) => r.doneAt !== null && Date.now() - r.doneAt <= PQ_DONE_DAYS * DAY_MS);
    }

    get pqFinishedMine() {
        return this.pqDoneRecent.filter((r) => r.coordinatorId === this.viewerId);
    }

    pqMatches(r) {
        const q = this.searchQuery.trim().toLowerCase();
        return !q || [r.name, r.email, r.projectName].some((v) => (v || '').toLowerCase().includes(q));
    }

    get pqListRows() {
        const base = this.pqFilter === 'Mine'
            ? this.pqOpenMine
            : this.pqFilter === 'No Project Coordinator' ? this.pqOpen.filter((r) => !r.coordinatorId) : this.pqOpen;
        const dir = this.sortOrder === 'oldest' ? 1 : -1;
        return base.filter((r) => this.pqMatches(r)).sort((a, b) => dir * (new Date(a.latestAt) - new Date(b.latestAt)));
    }

    /** Done replies at the end of Finished / All, by done time; only the search applies (as on the canvas). */
    get pqTail() {
        const src = this.tab === 'finished' ? this.pqFinishedMine : this.tab === 'team' ? this.pqDoneRecent : [];
        const dir = this.sortOrder === 'oldest' ? 1 : -1;
        return src.filter((r) => this.pqMatches(r)).sort((a, b) => dir * (a.doneAt - b.doneAt));
    }

    /** Card view models, with the selected card's earlier emails as child rows unless folded away. */
    pqItems(rows) {
        const out = [];
        rows.forEach((r) => {
            const on = r.key === this.activeId;
            const n = r.others.length;
            const expanded = on && n > 0 && !this.pqCollapsed[r.key];
            const tc = TYPE_CLASS[r.customerType] || 'ldr-type-unknown';
            const known = !!TYPE_CLASS[r.customerType];
            out.push({
                id: r.key,
                isPqCard: true,
                name: r.name,
                customerType: r.customerType,
                rowCls: 'ldr-row ' + tc + (on ? ' ldr-row-on' : ''),
                ageLabel: pqAge(r.done ? r.done.at : r.latestAt),
                hasTypeTag: known,
                typeIsText: !known,
                typeCls: 'ldr-tag ' + tc,
                project: r.projectName || 'No project name on the Contact',
                stage: r.oppStage || 'No opportunity',
                stageCls: 'ldr-tag ' + (r.oppClosed ? 'ldr-pq-stage-closed' : /quote/i.test(r.oppStage || '') ? 'ldr-pq-stage-quote' : 'ldr-pq-stage-open'),
                hasKind: !!r.segKind,
                kind: r.segKind,
                hasGeneralApp: !!r.generalApp,
                generalApp: r.generalApp,
                isDone: !!r.done,
                doneLabel: r.done ? '✓ ' + (PQ_TAG_LABEL[r.done.tag] || r.done.tag) : '',
                coordLabel: r.coordinator || 'No Project Coordinator',
                coordCls: 'ldr-pq-coord' + (r.coordinator ? '' : ' ldr-pq-coord-none'),
                hasMore: n > 0,
                moreLabel: (expanded ? '▾ ' : '▸ ') + n + ' more email' + (n > 1 ? 's' : '')
            });
            if (expanded) {
                r.others.forEach((o, i) => {
                    const b = o.body || '';
                    out.push({
                        id: r.key + '-e' + i,
                        isPqChild: true,
                        parentKey: r.key,
                        childDate: pqDateTime(o.at),
                        childSubject: o.subject,
                        childPreview: b.length > 90 ? b.slice(0, 87) + '…' : b
                    });
                });
            }
        });
        return out;
    }

    get pqActive() {
        return isPqKey(this.activeId) ? this.pqRows.find((r) => r.key === this.activeId) || null : null;
    }

    /** The Post Quote page replaces the record detail: on the Post Quote tab, or for a done reply in Finished / All. */
    get pqDetailVisible() {
        const a = this.pqActive;
        if (!a || this.isBossAllSubs) return false;
        if (this.tab === 'postquote') return true; // stays open after it's marked done (canvas)
        return (this.tab === 'finished' || this.tab === 'team') && this.pqTail.some((r) => r.key === a.key);
    }

    selectFirstPq() {
        const first = this.pqListRows[0];
        this.activeId = first ? first.key : null;
        this.saveView();
    }

    /** The first queue row of the current tab (not a section header or a Post Quote card). */
    firstQueueItem() {
        return this.visible.find((x) => !x.isSectionHeader && !x.isPqCard && !x.isPqChild);
    }

    handlePqCard(e) {
        const key = e.currentTarget.dataset.id;
        const r = this.pqRows.find((x) => x.key === key);
        if (!r) return;
        if (this.activeId === key && r.others.length) {
            this.pqCollapsed = { ...this.pqCollapsed, [key]: !this.pqCollapsed[key] };
            return;
        }
        const c = { ...this.pqCollapsed };
        delete c[key];
        this.pqCollapsed = c;
        this.activeId = key;
        this.message = undefined;
        this.saveView();
    }

    handlePqChild(e) {
        this.activeId = e.currentTarget.dataset.id;
        this.saveView();
    }

    handlePqFilter(e) {
        this.pqFilter = e.target.value || 'Mine';
        if (this.tab === 'postquote' && !this.pqListRows.some((r) => r.key === this.activeId)) this.selectFirstPq();
    }

    get pqFilterOptions() {
        return PQ_FILTERS.map((v) => ({ value: v, label: v, selected: v === this.pqFilter }));
    }

    get pqBlurb() {
        return 'Replies to the 6sense post-quote emails · one row per contact and project' + (this.pqSince ? ' · since ' + this.pqSince : '');
    }

    handlePostQuoteChanged() {
        this.loadPostQuote();
    }

    // ------------------------------------------------------------ getters: header & list

    /** Admin extras (Lead Views, relink notice) show only as yourself or in Boss View, not while viewing as another LDR. */
    get adminSelf() {
        return this.isAdmin && !this.viewingAsOther;
    }

    get tabs() {
        return TABS.filter((t) => !t.adminOnly || this.showSixSense).map((t) => {
            const on = this.tab === t.key;
            let count;
            if (t.key === 'prospects') count = this.prospectsLoaded ? this.prospectBestCount('') : '·';
            else if (t.key === 'postquote') count = this.pqLoaded ? this.pqOpenMine.length : '·';
            else if (t.key === 'sixsense') count = this.ssData ? this.ssMineCount : '·'; // #151: the Mine box
            else {
                // Finished / All also count the Post Quote replies marked done in the last 7 days (canvas #140).
                const pqDone = t.key === 'finished' ? this.pqFinishedMine.length : t.key === 'team' ? this.pqDoneRecent.length : 0;
                count = this.rows.filter((r) => this.inTab(r, t.key)).length + pqDone;
            }
            return {
                key: t.key,
                label: t.label,
                right: t.right,
                count,
                cls: 'ldr-tab' + (on ? ' ldr-tab-on' : ''),
                countCls: 'ldr-count' + (on ? ' ldr-count-on' : '')
            };
        });
    }

    get tabsLeft() {
        return this.tabs.filter((t) => !t.right);
    }

    get tabsRight() {
        return this.tabs.filter((t) => t.right);
    }

    get isUnclaimedTab() {
        return this.tab === 'unclaimed';
    }

    get tabRows() {
        return this.rows.filter((r) => this.inTab(r, this.tab));
    }

    get unclaimedCoordOptions() {
        const names = Array.from(new Set(this.tabRows.map((r) => r.coordinatorName).filter(Boolean))).sort();
        return selectOptions(
            [
                { value: 'All', label: 'Coordinator: All' },
                { value: '__none', label: 'No Coordinator' },
                ...names.map((n) => ({ value: n, label: n === this.viewerName ? n + ' (you)' : n }))
            ],
            this.unclaimedCoordFilter
        );
    }

    get recordFilterOptions() {
        return selectOptions(
            [
                { value: 'All', label: 'Record: All' },
                { value: 'Lead', label: 'Lead' },
                { value: 'Contact', label: 'Contact' },
                { value: 'No record yet', label: 'No record yet' }
            ],
            this.recordFilter
        );
    }

    get recTypeFilterOptions() {
        const src = this.isBossAllSubs ? this.allSubsBase : this.tabRows;
        const vals = Array.from(new Set(src.map((r) => r.recordType).filter(Boolean))).sort();
        return selectOptions([{ value: 'All', label: 'Type: All' }, ...vals.map((v) => ({ value: v, label: v }))], this.recTypeFilter);
    }

    get statusFilterOptions() {
        // Boss View > All Submissions: options from every loaded submission, not the current inbox tab (notes #89C).
        const vals = this.isBossAllSubs
            ? Array.from(new Set(this.allSubsBase.map((r) => r.status || '(blank)'))).sort()
            : Array.from(new Set(this.tabRows.map((r) => r.leadStatus || '(blank)'))).sort();
        // Notes #90: a blank status reads "Without Status" (inbox and All Submissions).
        return selectOptions(
            [{ value: 'All', label: 'Status: All' }, ...vals.map((v) => ({ value: v, label: v === '(blank)' ? 'Without Status' : v }))],
            this.statusFilter
        );
    }

    handleUnclaimedCoordFilter(e) {
        this.unclaimedCoordFilter = e.target.value || 'All';
    }

    handleRecordFilter(e) {
        this.recordFilter = e.target.value || 'All';
    }

    handleRecTypeFilter(e) {
        this.recTypeFilter = e.target.value || 'All';
    }

    handleStatusFilter(e) {
        this.statusFilter = e.target.value || 'All';
    }

    /** Admins: "View as" options = everyone who holds a claim in the loaded queue, plus yourself. */
    get viewAsOptions() {
        const seen = new Map();
        this.rows.forEach((r) => {
            if (r.claimedById && r.claimedById !== this.meId && r.claimedByName) seen.set(r.claimedById, r.claimedByName);
        });
        const others = Array.from(seen.entries())
            .map(([value, label]) => ({ value, label }))
            .sort((a, b) => a.label.localeCompare(b.label));
        return selectOptions(
            [{ value: BOSS_VIEW, label: 'Boss View' }, { value: '', label: this.meName + ' (you)' }, ...others],
            this.viewAsId
        );
    }

    get viewingAsOther() {
        return this.isAdmin && !!this.viewAsId && this.viewAsId !== BOSS_VIEW && this.viewAsId !== this.meId;
    }

    handleViewAs(e) {
        this.viewAsId = e.target.value || '';
        this.dismissedAlerts = {};
        this.loadUncontacted(); // #146: the alert follows the viewed LDR
        // #152 A: 6Sense is hidden while viewing as another LDR; from it, go to Unclaimed
        if (this.tab === 'sixsense' && !this.showSixSense) {
            this.tab = 'unclaimed';
            this.activeId = null;
            this.resetListFilters();
            const first = this.firstQueueItem();
            if (first) this.selectRow(first.id);
            this.saveView();
        }
    }

    // ------------------------------------------------------------ 6Sense tab (canvas #151, #152 A)

    /** Aqil / Aziz as themselves or in Boss View; not while viewing as another LDR. */
    get showSixSense() {
        return this.adminSelf;
    }

    get isSixSenseTab() {
        return this.tab === 'sixsense' && this.showSixSense;
    }

    /** Read-only Apex (admins only: it returns nothing for anyone else). Reloaded by ↻ and after a 6Sense status save. */
    async loadSixSense() {
        if (!this.showSixSense) return;
        const seq = ++this._ssSeq;
        this.ssLoading = true;
        try {
            const r = await getSixSenseRepliesApex();
            if (seq !== this._ssSeq) return;
            this.ssData = r || { people: [] };
            this.ssError = (r && r.error) || '';
        } catch (err) {
            if (seq === this._ssSeq) this.ssError = errorText(err);
        } finally {
            if (seq === this._ssSeq) this.ssLoading = false;
        }
    }

    handleSixSenseChanged() {
        this.loadSixSense();
    }

    /** "mine" | "unassigned" | null for a 6Sense person (#151 C): Mine = coordinator is the viewer. */
    ssBoxOf(p) {
        const id15 = (v) => String(v || '').slice(0, 15);
        if (p.coordinatorId && id15(p.coordinatorId) === id15(this.viewerId)) return 'mine';
        return p.unassigned ? 'unassigned' : null;
    }

    get ssPeople() {
        return (this.ssData && this.ssData.people) || [];
    }

    get ssMineCount() {
        return this.ssPeople.filter((p) => this.ssBoxOf(p) === 'mine').length;
    }

    get listEmptyText() {
        const q = this.listQuery;
        if (q) return 'No matches for “' + q + '” in this tab.' + (this.crossTab.has ? ' See “In other tabs” below.' : '');
        if (this.tab === 'postquote') {
            return this.pqFilter === 'Mine'
                ? 'No open post-quote replies on contacts where you are the Project Coordinator' + (this.pqSince ? ' since ' + this.pqSince : '') + '.'
                : 'No open post-quote replies here.';
        }
        if (this.tab === 'finished') {
            return 'Nothing finished in the last ' + FINISHED_DAYS + ' days. Leads and contacts you claimed show here for ' +
                FINISHED_DAYS + ' days after their status moves past New / Working.';
        }
        return this.tab === 'unclaimed' ? 'Nothing here. Every lead in this view has been claimed.' : 'Nothing here with these filters.';
    }

    get isTeamTab() {
        return this.tab === 'team';
    }

    get teamCoordinatorOptions() {
        const names = Array.from(
            new Set(this.rows.filter((r) => this.inTab(r, 'team')).map((r) => r.claimedByName).filter(Boolean))
        ).sort();
        return [{ value: 'All', label: 'Coordinator: All' }, ...names.map((n) => ({ value: n, label: n }))].map((o) => ({
            ...o,
            selected: o.value === this.coordinatorFilter
        }));
    }

    handleCoordinatorFilter(e) {
        this.coordinatorFilter = e.target.value || 'All';
    }

    get sla() {
        return Number(this.slaMinutes) || 15;
    }

    /**
     * Conversation-style grouping (canvas c90e): submissions from the same person (same Lead, same Contact, or same
     * email when neither is linked) are listed together. The newest is the header row; the rest are indented under
     * it while one of them is selected. They stay separate submissions (claiming one still claims the others).
     */
    get visible() {
        if (this.tab === 'postquote') return this.pqItems(this.pqListRows);
        const flat = this.visibleFlat;
        const out = this.tab === 'mine' ? this.mineSections(flat) : this.groupRows(flat);
        // canvas #140: Post Quote replies marked done, at the end of Finished / All under their own header
        const tail = this.pqTail;
        if (tail.length) {
            out.push({
                id: 'pq-done-hdr',
                isSectionHeader: true,
                sectionLabel: 'Post Quote replies',
                sectionCount: tail.length,
                sectionCls: 'ldr-mine-head' + (out.length ? '' : ' ldr-mine-head-first')
            });
            out.push(...this.pqItems(tail));
        }
        return out;
    }

    mineSections(flat) {
        // canvas #126 / #131: Mine in sections, New then Working (each still by submitted time); "Other" only if a
        // row that is neither lands here (e.g. a claimed submission with no Lead / Contact yet). Empty sections are left out.
        // v6f9 (Aqil): Other first when it's there, then New, then Working.
        const out = [];
        const sect = (key, label, rows) => {
            if (!rows.length) return;
            const g = this.groupRows(rows);
            out.push({
                id: 'mine-hdr-' + key,
                isSectionHeader: true,
                sectionLabel: label,
                sectionCount: g.filter((x) => !x.isChild).length, // a person's grouped submissions count once
                sectionCls: 'ldr-mine-head' + (out.length ? '' : ' ldr-mine-head-first')
            });
            out.push(...g);
        };
        // v7 (Aqil): a submission with no Lead / Contact yet and "#Working" goes under Working, not Other
        const st = (r) => (r.isUnlinked && r.unlinkedStatus === 'Working' ? 'Working' : r.leadStatus);
        sect('other', 'Other', flat.filter((r) => !ACTIVE_STATUSES.includes(st(r))));
        sect('new', 'New', flat.filter((r) => st(r) === 'New'));
        sect('working', 'Working', flat.filter((r) => st(r) === 'Working'));
        return out;
    }

    /** Same person's submissions grouped under the newest (see `visible`). */
    groupRows(flat) {
        const n = flat.length;
        const parent = flat.map((_, i) => i);
        const find = (i) => {
            let x = i;
            while (parent[x] !== x) {
                parent[x] = parent[parent[x]];
                x = parent[x];
            }
            return x;
        };
        const keyOf = (r) => {
            if (r.leadId) return 'L' + r.leadId;
            if (r.contactId) return 'C' + r.contactId;
            return r.email ? 'E' + r.email.toLowerCase() : 'X' + r.id;
        };
        const firstByKey = {};
        const byEmail = {};
        for (let i = 0; i < n; i++) {
            const k = keyOf(flat[i]);
            if (firstByKey[k] === undefined) firstByKey[k] = i;
            else parent[find(i)] = find(firstByKey[k]);
            const em = (flat[i].email || '').toLowerCase();
            if (em) (byEmail[em] = byEmail[em] || []).push(i);
        }
        // Canvas samePerson: a submission with no Lead or Contact joins every row with the same email, linked or not.
        for (let i = 0; i < n; i++) {
            const r = flat[i];
            const em = (r.email || '').toLowerCase();
            if (!r.leadId && !r.contactId && em) byEmail[em].forEach((j) => {
                parent[find(j)] = find(i);
            });
        }
        const groups = {};
        const order = [];
        flat.forEach((r, i) => {
            const g = find(i);
            if (!groups[g]) {
                groups[g] = [];
                order.push(g);
            }
            groups[g].push(r);
        });
        const tag = (r) => r.form;
        const snippet = (r) => {
            const c = r.raw.Questions_or_Comments__c || '';
            return r.estimatePreview || r.ldrProject || r.raw.Project_Name__c || (c.length > 60 ? c.slice(0, 57) + '…' : c);
        };
        const out = [];
        order.forEach((g) => {
            const members = groups[g];
            if (members.length === 1) {
                out.push({ ...members[0], isChild: false, isGroupHead: false });
                return;
            }
            const byNewest = members.slice().sort((x, y) => x.sortMin - y.sortMin);
            const head = byNewest[0];
            const kids = byNewest.slice(1);
            const key = members.map((m) => m.id).sort()[0];
            const expanded = members.some((m) => m.id === this.activeId) && !this.collapsedGroups[key];
            // canvas #125: just the "▸ N submissions" pill (the "Also: Quote · Consultation" text is gone)
            out.push({
                ...head,
                isChild: false,
                isGroupHead: true,
                groupKey: key,
                groupExpanded: expanded,
                groupLabel: (expanded ? '▾ ' : '▸ ') + members.length + ' submissions'
            });
            if (expanded) {
                kids.forEach((k) =>
                    out.push({
                        ...k,
                        isChild: true,
                        isGroupHead: false,
                        groupKey: key,
                        childLabel: tag(k),
                        childPreview: snippet(k),
                        hasChildPreview: !!snippet(k),
                        childCls: 'ldr-row-child' + (k.id === this.activeId ? ' ldr-row-on' : '')
                    })
                );
            }
        });
        return out;
    }

    /** The search box test: name or email (Post Quote also matches the project, in pqMatches). */
    matchesSearch(r) {
        const q = this.listQuery.toLowerCase();
        return !q || (r.name || '').toLowerCase().includes(q) || (r.email || '').toLowerCase().includes(q);
    }

    /** Every standard-list filter except the tab and the search. */
    passesListFilters(r) {
        const uc = this.unclaimedCoordFilter;
        return (this.tab !== 'team' || this.coordinatorFilter === 'All' || r.claimedByName === this.coordinatorFilter) &&
            (this.tab !== 'unclaimed' || uc === 'All' || (uc === '__none' ? !r.coordinatorName : r.coordinatorName === uc)) &&
            (this.recordFilter === 'All' || r.recordKind === this.recordFilter) &&
            (this.formFilter === 'All' || r.form === this.formFilter) &&
            (!['mine', 'team'].includes(this.tab) || this.seqFilter === 'all' || this.sequenceState(r) === this.seqFilter) &&
            (this.recTypeFilter === 'All' || r.recordType === this.recTypeFilter) &&
            (this.statusFilter === 'All' || (r.leadStatus || '(blank)') === this.statusFilter);
    }

    /** In the Prospects pool on screen: the selected list, the Prospects filters and the search. */
    inProspectPool(r) {
        const pc = this.prospectCoordFilter;
        return this.inTab(r, 'prospects') && r.prospectList === this.prospectList && this.matchesSearch(r) &&
            (pc === 'All' || (pc === '__none' ? !r.coordinatorName : r.coordinatorName === pc)) &&
            (this.recTypeFilter === 'All' || r.recordType === this.recTypeFilter) &&
            (this.statusFilter === 'All' || (r.leadStatus || '(blank)') === this.statusFilter);
    }

    /** Shown in the current tab's list (Post Quote lists no queue rows). */
    isShownInList(r) {
        if (this.tab === 'prospects') return this.inProspectPool(r);
        return this.inTab(r, this.tab) && this.passesListFilters(r) && this.matchesSearch(r);
    }

    get visibleFlat() {
        const sla = this.sla;
        // canvas #156: Mine, Finished and All by claim time (rows without one: submitted time); other tabs by submitted time.
        const byClaim = CLAIM_DATED_TABS.includes(this.tab);
        const sortMin = (r) => (byClaim ? r.claimAgeMin : r.ageMin);
        return this.rows
            .filter((r) => this.inTab(r, this.tab) && this.passesListFilters(r) && this.matchesSearch(r))
            .sort((a, b) => (this.sortOrder === 'oldest' ? sortMin(b) - sortMin(a) : sortMin(a) - sortMin(b)))
            .map((r) => {
                const open = !r.claimedById;
                const late = open && r.ageMin > sla;
                const warn = open && !late && r.ageMin > sla / 2;
                const typeCls = TYPE_CLASS[r.customerType] || 'ldr-type-unknown';
                const no = this.tab === 'mine' ? this.noOutreach(r) : null;
                const opp = this.openOppInfo(r);
                const hasRelated = r.kbmaxCount + r.estimateCount > 0;
                const showStale = open && (this.isStaleStatus(r) || DECIDED_STATUSES.includes(r.leadStatus));
                const showAssigned = this.tab === 'mine' && r.claimedById === this.viewerId && !!r.assignedBy && r.assignedBy !== this.viewerName;
                return {
                    ...r,
                    rowCls: 'ldr-row ' + typeCls + (r.id === this.activeId ? ' ldr-row-on' : ''),
                    hasTypeTag: ['Homeowner', 'Contractor', 'Architect', 'Business Owner'].includes(r.customerType),
                    customerType: r.customerType || '',
                    typeIsText: !['Homeowner', 'Contractor', 'Architect', 'Business Owner'].includes(r.customerType),
                    formCls: inquiryCls(r.form),
                    formLabel: r.form,
                    typeCls: 'ldr-tag ' + typeCls,
                    ageLabel: byClaim && r.claimedAt ? ageLabel(r.claimAgeMin, r.claimedAt) : ageLabel(r.ageMin, r.submitted),
                    sortMin: sortMin(r),
                    ageCls: 'ldr-age' + (late ? ' ldr-age-late' : warn ? ' ldr-age-warn' : ''),
                    hasCampaign: !!r.campaign,
                    campaignLabel: r.campaign ? r.campaign.label : '',
                    campaignCls: 'ldr-tag ldr-campaign-' + (r.campaign ? r.campaign.kind : 'none'),
                    hasRelated,
                    relatedLabel: [
                        r.kbmaxCount ? '+' + r.kbmaxCount + ' KBMax' : null,
                        r.estimateCount ? '+' + r.estimateCount + ' Estimate' : null
                    ]
                        .filter(Boolean)
                        .join(' · '),
                    showNeedsStatusFlag: this.tab === 'mine' && r.claimedById === this.viewerId && r.leadStatus === 'New',
                    showStaleNurtureFlag: showStale,
                    showAssignedFlag: showAssigned,
                    // canvas #125: the card's third line (every flag but the form / type tags) only when it has content
                    hasMidFlags: !!(r.isProspect || hasRelated || r.campaign || opp || r.junkReason || no || showStale || showAssigned),
                    assignedByShort: firstName(r.assignedBy),
                    showUnlinkedFlag: r.isUnlinked,
                    showNoOutreach: !!no,
                    noOutreachLabel: no ? no.label : '',
                    showOpenOppFlag: !!opp,
                    isJunk: !!r.junkReason,
                    junkLabel: r.junkReason || '',
                    openOppLabel: opp ? opp.label : '',
                    openOppTitle: opp ? 'Open opportunity with a rep' + (opp.owners.length ? ': ' + opp.owners.join(', ') : '') : '',
                    // Bottom-right: "Lead: <full name>" / "Contact: <full name>", including your own name.
                    showCoordFlag: open && !!r.coordinatorName,
                    // #95: a leading "Samantha " reads "Sam " on the card tag only (filters, header and banners keep the full name).
                    coordFlagLabel: '⚠ ' + (r.isContactLinked ? 'Contact' : 'Lead') + ': ' + (r.coordinatorName || '').replace(/^Samantha /, 'Sam '),
                    showClaimLabel: this.tab !== 'unclaimed' && !!r.claimedById,
                    claimLabel: r.claimedByName || '',
                    hasBottomRight: (open && !!r.coordinatorName) || (this.tab !== 'unclaimed' && !!r.claimedById),
                    showOutbound: r.isProspect
                };
            });
    }

    get sortArrow() {
        return this.sortOrder === 'newest' ? '↑' : '↓';
    }

    get sortTitle() {
        return this.sortOrder === 'newest' ? 'Newest on Top' : 'Oldest on Top';
    }

    toggleSortOrder() {
        this.sortOrder = this.sortOrder === 'newest' ? 'oldest' : 'newest';
        this.saveView();
    }

    get listEmpty() {
        if (this.tab === 'postquote') return this.pqLoaded && this.pqListRows.length === 0;
        return !this.loading && this.visibleFlat.length === 0 && this.pqTail.length === 0;
    }

    /** Group header click: open the group (select its newest), or collapse it when it's already open on the head. */
    handleGroupHead(e) {
        const id = e.currentTarget.dataset.id;
        const key = e.currentTarget.dataset.group;
        const row = this.visible.find((x) => x.id === id);
        const open = row && row.groupExpanded;
        if (open && this.activeId === id) {
            this.collapsedGroups = { ...this.collapsedGroups, [key]: true };
            return;
        }
        const c = { ...this.collapsedGroups };
        delete c[key];
        this.collapsedGroups = c;
        if (this.activeId !== id) this.selectRow(id);
    }

    get loadedAtLabel() {
        return this.loadedAt
            ? new Date(this.loadedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
            : '';
    }

    // ------------------------------------------------------------ getters: detail

    get active() {
        const r = this.rows.find((x) => x.id === this.activeId);
        if (!r) return null;
        const s = r.raw;
        const lead = s.Lead__r || {};
        const mine = r.claimedById === this.meId;
        const blank = (v) => (v ? v : 'Not provided');
        const application = s.Application__c || s.Project_Application__c;
        // 3 per row: Inquiry type, Customer type, Project name / Application, Product, Project zip /
        // Construction Classification, Timeline.
        // canvas 9fed: full submission date and time (Pacific) first in "What they submitted". v6f8: no " PT" after it
        // (the whole team is on Pacific time); still shown in Pacific on any computer.
        const submittedFull = r.submitted
            ? new Date(r.submitted).toLocaleString('en-US', {
                  month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/Los_Angeles'
              })
            : '';
        const factPairs = [
            ['Submitted', submittedFull],
            ['Inquiry type', s.Inquiry_Type__c],
            ['Customer type', s.Customer_Type__c],
            // Form values only (not the LDR's Project Details edits). Homeowners with no project name on the form
            // get "[Last name] Residence"; their project zip is normally their own zip.
            ['Project name', formProjectName(s, r)],
            ['Application', application ? application.split(',').map((x) => x.trim()).join(', ') : application],
            ['Product', s.Product_Type__c],
            ['Project zip', r.customerType === 'Homeowner' ? s.Zip_or_Postal_Code__c : s.Project_Postal_Code__c],
            ['Project Construction Classification', s.Project_Construction_Classification__c || s.Project_Type__c],
            ['Timeline', s.Project_Timeline__c]
        ];
        // Windfall Information (Homeowners only) — its own card. Contacts (canvas 9fed): the Contact's own values, or
        // the converted Lead's until Windfall re-populates on the Contact a day or two after conversion.
        const isHomeowner = r.customerType === 'Homeowner';
        const wf = this.windfallSource(r);
        const wfDate = wfDateLabel(wf.wf_net_worth_calculation_date__c);
        const windfallPairs = [
            ['B2C Lead Grade', wf.Windfall_Lead_Grade__c],
            ['Estimated Property Value', money(wf.wf_windfall_avm__c)],
            ['Net Worth', money(wf.wf_net_worth__c)],
            ['High Confidence Net Worth', money(wf.wf_high_confidence_net_worth__c)],
            ['Low Confidence Net Worth', money(wf.wf_low_confidence_net_worth__c)],
            ['Net Worth Last Calculated', wfDate],
            ['Additional Windfall Property Value 1', money(wf.wf_windfall_property_value_1__c)],
            ['Additional Windfall Property Value 2', money(wf.wf_windfall_property_value_2__c)],
            ['Additional Windfall Property Value 3', money(wf.wf_windfall_property_value_3__c)]
        ];
        const windfallFacts = windfallPairs.map(([k, v]) => ({ k, v: v || '—' }));
        const windfallEmpty = windfallPairs.every(([, v]) => !v);
        const contact = s.Contact__r || {};
        const rec = r.isContactLinked
            ? { name: contact.Name, email: contact.Email, city: contact.MailingCity, state: contact.MailingState, zip: contact.MailingPostalCode, kind: 'Contact' }
            : { name: lead.Name, email: lead.Email, city: lead.City, state: lead.State, zip: lead.PostalCode, kind: 'Lead' };
        const leadCityState = [rec.city, rec.state].filter(Boolean).join(', ');
        // canvas #131B: the Lead / Contact address; if it has none, the submission's zip (no "zip from the form" note)
        const formZip = String(s.Zip_or_Postal_Code__c || s.Project_Postal_Code__c || '').trim();
        const locationLine =
            leadCityState && rec.zip
                ? leadCityState + ' ' + rec.zip
                : leadCityState ||
                  rec.zip ||
                  formZip ||
                  (r.isUnlinked
                      ? r.isEstimate
                          ? 'No zip on the estimate; no Lead or Contact yet'
                          : 'No Lead or Contact yet'
                      : 'No address on ' + rec.kind);
        const est = r.estimate || {};
        // Instant Estimate layout (3 per row, canvas #152 L; no Inquiry type): Submitted, Instant Estimate Name (link),
        // Estimate / Frame type, Opening Width, Opening Height / Customer type, Project Construction Classification, Application.
        const estimateFactPairs = [
            ['Submitted', submittedFull],
            ['Instant Estimate Name', est.number, s.Id, 1, 'Website_Instant_Estimate__c'],
            ['Estimate', est.amount],
            ['Frame type', est.frameType],
            ['Opening Width', est.width],
            ['Opening Height', est.height],
            ['Customer type', s.Customer_Type__c],
            ['Project Construction Classification', est.classification],
            ['Application', application ? application.split(',').map((x) => x.trim()).join(', ') : application]
        ];
        // Lunch & Learn Request: Company (Account link on Contacts), Courses, form zip, Reporting Matched Account.
        const isLL = s.Inquiry_Type__c === LUNCH_AND_LEARN;
        const llContact = s.Contact__r || {};
        const llAccountId = r.isContactLinked ? llContact.AccountId : lead.LeanData__Reporting_Matched_Account__c;
        const llAccountName = r.isContactLinked
            ? llContact.Account && llContact.Account.Name
            : lead.LeanData__Reporting_Matched_Account__r && lead.LeanData__Reporting_Matched_Account__r.Name;
        // Lunch & Learn layout (3 per row): Inquiry type, Customer type, Zip / Company, Courses (spans 2) /
        // Reporting Matched Account (Leads only; on Contacts the Company link is the Account).
        const llPairs = [
            ['Submitted', submittedFull],
            ['Inquiry type', s.Inquiry_Type__c],
            ['Customer type', s.Customer_Type__c],
            ['Zip or Postal Code', s.Zip_or_Postal_Code__c],
            ['Company', r.isContactLinked ? llAccountName : s.Company__c, r.isContactLinked ? llAccountId : null, 1, 'Account'],
            ['Courses', this.courses[s.Id], null, 2]
        ].concat(r.isContactLinked ? [] : [['Reporting Matched Account', llAccountName, llAccountId, 1, 'Account']]);
        // 3D configurator person (prospecting): quote activity, not a form.
        const kbp = r.kb || {};
        const dmy = (v) => (v ? new Date(v).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '');
        const configFactPairs = [
            ['Inquiry type', CONFIGURATOR],
            ['Customer type', s.Customer_Type__c],
            ['Company', s.Company__c],
            ['Quotes since ' + (this.prospectSince || 'the start date'), String(kbp.n || '')],
            ['Highest quote', kbp.max ? '$' + Math.round(kbp.max).toLocaleString() : ''],
            ['Latest quote', dmy(kbp.latest)],
            ['First quote', dmy(kbp.first)],
            ['Record created', dmy(kbp.recCreated)],
            ['Territory', (r.isContactLinked ? (s.Contact__r || {}).Territory__c : lead.Territory__c) || '']
        ];
        const facts = (r.isConfigurator ? configFactPairs : r.isEstimate ? estimateFactPairs : isLL ? llPairs : factPairs).map(([k, v, linkId, span, linkObject]) => ({
            k,
            v: blank(v),
            cls: v ? 'ldr-fact-v' : 'ldr-fact-v ldr-fact-empty',
            hasLink: !!(v && linkId),
            linkId: v && linkId ? linkId : null,
            linkObject: linkObject || 'Account',
            wrapCls: span === 2 ? 'ldr-fact ldr-fact-span2' : 'ldr-fact'
        }));

        // "Check before hand-off" bullets. UTM and Project Application form-vs-Lead checks were removed
        // (2026-10-02): those values are submission-specific and were never expected to reach the Lead.
        const mismatches = [];
        // Guard against a submission linked to the wrong Lead: the name/email shown here come from the
        // form, but Open Lead / Convert act on the linked Lead.
        const norm = (v) => (v || '').trim().toLowerCase();
        const formName = norm([s.First_Name__c, s.Last_Name__c].filter(Boolean).join(' '));
        const nameDiffers = !!formName && !!rec.name && formName !== norm(rec.name);
        const emailDiffers = !!s.Email_Address__c && !!rec.email && norm(s.Email_Address__c) !== norm(rec.email);
        const linkMismatch = nameDiffers && (emailDiffers || !rec.email);
        if (linkMismatch) {
            mismatches.unshift(
                'This submission is from ' + [s.First_Name__c, s.Last_Name__c].filter(Boolean).join(' ') +
                    (s.Email_Address__c ? ' (' + s.Email_Address__c + ')' : '') +
                    ' but is linked to ' + rec.kind + ' ' + rec.name + (rec.email ? ' (' + rec.email + ')' : '') +
                    '. The record buttons act on ' + rec.name + '. Check the ' + rec.kind +
                    ' field on the Form Submission before working it.'
            );
        }
        if (lead.Type__c && s.Customer_Type__c && lead.Type__c !== s.Customer_Type__c) {
            mismatches.push('Form said ' + s.Customer_Type__c + ', but the Lead is now ' + lead.Type__c + '. The inbox uses the Lead value.');
        }
        // v5.7: Contact rows use the Contact's Lead Type for the type flag and the FETR
        if (r.isContactLinked && r.recordType && s.Customer_Type__c && r.recordType !== s.Customer_Type__c) {
            mismatches.push('Form said ' + s.Customer_Type__c + ", but the Contact's Lead Type is " + r.recordType + '. The inbox uses the Contact value.');
        }

        const attachments = parseAttachments(s.Attachments__c);

        const comments = s.Questions_or_Comments__c || s.Comments__c;
        const coordIsOther = !!r.coordinatorId && r.coordinatorId !== this.meId;
        const recObj = r.isContactLinked ? 'Contact' : 'Lead';
        let convertedAfterDetail = '';
        if (r.convertedAfter) {
            const conv = new Date(r.convertedAt);
            const gapMin = Math.round((conv - new Date(r.submitted)) / 60000);
            const gap = gapMin < 60 ? gapMin + ' min' : gapMin < 2880 ? Math.round(gapMin / 60) + ' hr' : Math.round(gapMin / 1440) + ' days';
            convertedAfterDetail =
                'Lead converted ' + conv.toLocaleDateString() + ' ' +
                conv.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) + ', ' + gap +
                ' after the ' + (r.isEstimate ? 'instant estimate' : 'form') + ' came in. Review it and update Lead Funnel Status: anything other than New or Working takes it off the list. You can do that without claiming it.';
        }
        const showCoordWarning = !r.claimedById && coordIsOther;
        // Admins may edit an unclaimed, linked row's LDR fields without claiming it (Hand-off still needs a claim).
        // v7 (Aqil): the admins (Aqil, Aziz) may also edit another LDR's claim from the All tab
        const editable = !r.isUnlinked && !(r.isConfigurator && !this.configuratorClaimable);
        const adminOthers = this.isAdmin && this.tab === 'team' && !!r.claimedById && !mine && editable;
        const adminEdit = (this.canEditUnclaimed && !r.claimedById && editable) || adminOthers;
        const canEdit = mine || adminEdit;
        const no = this.tab === 'mine' ? this.noOutreach(r) : null;
        const opp = this.openOppInfo(r);
        const ctx = this.claimCtx && this.claimCtx.submissionId === r.id ? this.claimCtx : null;
        const pre = this.draft.pre || {};
        const has = (k) => Object.prototype.hasOwnProperty.call(pre, k);
        const ma = lead.LeanData__Reporting_Matched_Account__r;
        // Plain-text draft (mailto: bodies can't carry HTML), Bcc'd to the LDR mailbox. Field order is the
        // one the LDR team asked for. There is no Frame field on Form Submission, so Frame stays blank.
        const submitAt = s.Submit_Time__c || s.CreatedDate;
        const listify = (v) => (v || '').split(',').map((x) => x.trim()).filter(Boolean).join(', ');
        const summaryRows = [
            ['Submit Time', submitAt ? new Date(submitAt).toLocaleString('en-US') : ''],
            ['First Name', s.First_Name__c],
            ['Last Name', s.Last_Name__c],
            ['Company', s.Company__c],
            ['Email Address', s.Email_Address__c],
            ['Phone Number', s.Phone_Number__c],
            ['Country', s.Country__c],
            ['Zip or Postal Code', s.Zip_or_Postal_Code__c],
            ['Customer Type', s.Customer_Type__c],
            ['Project Name', s.Project_Name__c],
            ['Application', listify(s.Application__c)],
            ['Project Postal Code', s.Project_Postal_Code__c],
            ['Questions or Comments', s.Questions_or_Comments__c || s.Comments__c],
            ['Inquiry Type', s.Inquiry_Type__c],
            ['Project Type', r.isEstimate ? (r.estimate || {}).classification : s.Project_Type__c],
            ['Project Timeline', s.Project_Timeline__c],
            ['Product Type', r.isEstimate ? (r.estimate || {}).frameType : s.Product_Type__c],
            ['Frame', r.isEstimate ? [(r.estimate || {}).width, (r.estimate || {}).height].filter(Boolean).join(' x ') : '']
        ];
        // Extra lines for the draft email: a link to the nearest design studio (more can be added later).
        const near = this.nearestFor(r);
        const extras = near && near.url
            ? [{ key: 'studio', before: 'We have a design studio near you: ', linkText: 'NanaWall Design Studio – ' + near.studio, url: near.url, after: ' (about ' + near.miles + ' miles away).' }]
            : [];
        const rowObjs = summaryRows.map(([k, v]) => ({ k, v: v === null || v === undefined ? '' : v }));
        // canvas aabc (#96B): the selected message template ('' = none) goes at the top of the email. #152 H / #155 B:
        // the message is editable (starts as the template); the copy uses the edited text. A blank message keeps the
        // blank lines at the top.
        const tplKind = this.showEmailPreview ? this.emailTemplate : '';
        const tplText = templateToMessage(emailTemplateLines(tplKind, s.First_Name__c || (r.name || '').split(' ')[0]));
        const msgText = this.showEmailPreview && this.emailMessage !== null ? this.emailMessage : tplText;
        const tpl = msgText.trim() ? messageToLines(msgText) : [];
        // #160: only this submission's own project name (a form's Project_Name__c, a configurator quote's Project Name;
        // instant estimates have none), never the LDR's Project Name or one carried over from an earlier submission.
        // None -> the inquiry type. v6g3: the LDR can edit it in Draft Email (emailSubjectEdit, until it's closed).
        const autoSubject = 'NanaWall | ' + (String(s.Project_Name__c || s.cfgProjectName || '').trim() || s.Inquiry_Type__c || 'Inquiry');
        const subject = this.showEmailPreview && this.emailSubjectEdit !== null ? this.emailSubjectEdit : autoSubject;
        // v6g3 (Aqil): Draft Email's Submission Details line (the submission's own values, as What They Submitted shows
        // them; Location is the Lead / Contact's) and its one-line Questions or Comments
        const orDash = (v) => (v === null || v === undefined || String(v).trim() === '' ? '—' : String(v).trim());
        const appText = application ? application.split(',').map((x) => x.trim()).join(', ') : '';
        const subPairs = r.isEstimate
            ? [
                  ['Type', s.Customer_Type__c],
                  ['Form', s.Inquiry_Type__c],
                  ['Estimate', est.amount],
                  ['Frame type', est.frameType],
                  ['Opening Width', est.width],
                  ['Opening Height', est.height]
              ]
            : [
                  ['Type', s.Customer_Type__c],
                  ['Form', s.Inquiry_Type__c],
                  ['Location', [leadCityState, rec.zip].filter(Boolean).join(' ')],
                  ['Project Zip', r.customerType === 'Homeowner' ? s.Zip_or_Postal_Code__c : s.Project_Postal_Code__c],
                  ['Project Name', formProjectName(s, r)],
                  ['Application', appText]
              ];
        const emailQcFull = String(comments || '').replace(/\s+/g, ' ').trim();
        const email = {
            subject,
            body: (tpl.length ? emailTemplateText(tpl) : '\n')
                .split('\n')
                .concat(summaryRows.map(([k, v]) => k + ':\t' + (v || '')))
                .join('\n'),
            rows: rowObjs,
            extras,
            html: emailRichHtml(rowObjs, extras, tpl),
            text: emailRichText(rowObjs, extras, tpl)
        };

        return {
            ...r,
            companyLine: r.company || 'No company',
            accountLine: r.company || (contact.Account && contact.Account.Name) || (isHomeowner ? r.name : 'No company'),
            // v6d: shorter header labels, no "Open" (Aqil)
            recordButtonLabel: r.isContactLinked ? 'Contact ↗' : 'Lead ↗',
            recordIcon: r.isContactLinked ? 'standard:contact' : 'standard:lead',
            recordIconAlt: r.isContactLinked ? 'Contact' : 'Lead',
            isLeadLinked: !r.isContactLinked,
            recordObject: recObj,
            // One-item key lists: each edit form is re-created per submission/record (and on Cancel) instead of having
            // record-id / object-api-name swapped on a live form, which breaks the Project Coordinator lookup.
            formKeys: [r.id + ':' + recObj + ':' + (s.Lead__c || s.Contact__c || '') + ':' + this.formNonce],
            recordWordLower: recObj.toLowerCase(),
            claimLabel: r.isContactLinked ? 'Claim Contact' : 'Claim Lead',
            adminEdit,
            adminEditNote: adminOthers
                ? 'Editing ' + (r.claimedByName || 'another LDR') + '’s claim as an admin. Saves go to Salesforce as ' + this.meName +
                  '; the claim stays with ' + (r.claimedByName || 'them') + '. Hand-off still needs the claimer.'
                : 'Editing without claiming. Saves go to Salesforce as ' + this.meName + '; claiming stays separate. Hand-off still needs a claim.',
            canReassign: mine && !!ctx && ctx.canReassign,
            reassignTo: ctx ? ctx.previousCoordinatorName || 'the previous coordinator' : '',
            reassignTitle: ctx ? 'Give it back to ' + (ctx.previousCoordinatorName || 'the previous coordinator') : '',
            coordValue: (has('Project_Coordinator__c') ? pre.Project_Coordinator__c : r.coordinatorId) || '',
            coordOptions: this.coordinatorOptions(r.coordinatorId, r.coordinatorName),
            funnelTsValue: has('Lead_Funnel_Time_Stamp__c') ? pre.Lead_Funnel_Time_Stamp__c || null : r.funnelTs,
            noOutreachVisible: !!no && !(this.dismissedAlerts[r.id + ':noOutreach']),
            noOutreachText: no ? no.text : '',
            relatedTitle: 'Related submissions on this ' + recObj.toLowerCase(),
            submissionLabel: r.isConfigurator
                ? '3D Configurator ↗'
                : r.isEstimate ? 'Instant Estimate ↗' : 'Form Submission ↗',
            submissionLinkLabel: r.isConfigurator ? 'Open ' + recObj : r.isEstimate ? 'Open Instant Estimate' : 'Open Form Submission',
            submissionNoun: r.isConfigurator ? 'web configurator quote' : r.isEstimate ? 'instant estimate' : 'form submission',
            formCls: inquiryCls(r.form),
            formLabel: r.form,
            hasSixSense: this.sixSenseValues.length > 0 && !r.isUnlinked && !(r.isConfigurator && !this.configuratorClaimable),
            showFollowUp: !r.isUnlinked && !(r.isConfigurator && !this.configuratorClaimable),
            sixSenseLabel: '6Sense Option (' + recObj + '.X6Sense_Option__c)',
            sixSenseValue: this.sixSenseDraft && this.sixSenseDraft.id === r.id ? this.sixSenseDraft.value : r.sixSense || '',
            sixSenseDirty: !!this.sixSenseDraft && this.sixSenseDraft.id === r.id && (this.sixSenseDraft.value || '') !== (r.sixSense || ''),
            followUpRows: (() => {
                const f = r.followUp || {};
                const pretty = (v) => (v ? v.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()) : '');
                const row = (k, v) => ({ k, v: v || '—', cls: v ? 'ldr-fact-v' : 'ldr-fact-v ldr-fact-empty' });
                return [
                    row('CE Campaign Name', f.sixsense_ce__campaign_name__c),
                    row(
                        'CE Last Synced Time',
                        f.sixsense_ce__last_synced_at__c
                            ? new Date(f.sixsense_ce__last_synced_at__c).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                            : ''
                    ),
                    row('CE Contact Status (CE Lead Status on Leads)', pretty(f.sixsense_ce__status__c)),
                    row('Outreach Current Active Sequence Name', f.Outreach_Current_Active_Sequence_Name__c),
                    row('Outreach Finished Sequences', f.Outreach_Finished_Sequences__c)
                ];
            })(),
            currentTab: this.currentTabLabel(r),
            ...this.goTabFor(r), // canvas #143B
            // canvas #119: Attach to Opportunity (Contact rows; the template shows it in Mine only)
            canAttachOpp: r.isContactLinked && !!r.contactId,
            showFetr: r.isContactLinked,
            fetrRows: r.isContactLinked ? this.fetrRows(r) : [],
            fetrEdited: !!this.fetrEdits[r.id] && Object.keys(this.fetrEdits[r.id]).length > 0, // v6f8: shows Reset
            ...this.fetrProjectView(r),
            emailRows: email.rows,
            emailExtras: email.extras,
            hasEmailExtras: email.extras.length > 0,
            hasEmailTemplate: tpl.length > 0,
            emailMessageText: msgText,
            emailMessageEdited: this.emailMessage !== null && this.emailMessage !== tplText,
            emailMessageRows: Math.max(8, Math.min(16, msgText.split('\n').length + 1)), // v6g4: 8 rows to start (was 4)
            showEstTemplates: !!r.isEstimate,
            emailTplButtons: EMAIL_TEMPLATES.filter((t) => !t.estimateOnly || r.isEstimate).map((t) => ({
                ...t,
                cls: 'ldr-status-btn' + (tplKind === t.kind ? ' ldr-status-btn-on' : '')
            })),
            emailCopiedText: tpl.length
                ? '✓ Copied. In the email, click in the body and press Ctrl+V: the message and the details paste in together.' +
                  (tplKind === 'handoff' ? ' Replace InsertRepInfo with the rep’s contact details.' : '')
                : '✓ Copied. In the email, click in the body, press Ctrl+V, then write your message in the blank lines at the top.',
            // v6g3 (Aqil): shorter
            emailHintText: tpl.length
                ? 'The copy starts with the message above.'
                : 'The copy starts with a few blank lines so you can write your message above the details.',
            // v6g4 (Aqil): a blank value is left out, with its " · "
            emailSubItems: subPairs.filter(([, v]) => orDash(v) !== '—').map(([k, v], i) => ({ key: 'es' + i, k, v: orDash(v), sep: i > 0 })),
            emailQc: emailQcFull || '—',
            emailQcTitle: emailQcFull,
            emailHtml: email.html,
            emailText: email.text,
            mailtoNoBodyHref: r.email
                ? 'mailto:' + r.email + '?subject=' + encodeURIComponent(email.subject) + '&bcc=' + encodeURIComponent(LDR_BCC)
                : null,
            nearbyShowroomUrl: near ? near.url : '',
            convertUrl: r.leadId && !r.isContactLinked ? leadConvertFlowUrl(r.leadId) : null,
            fieldsTitle: 'LDR Fields',
            statusLabel: r.isContactLinked ? 'Lead Funnel Status' : 'Lead Status',
            historyLabel: recObj + ' History: field changes',
            convertedAfter: r.convertedAfter,
            convertedAfterDetail,
            // Status can be changed without claiming only when the Lead was converted after the form came in.
            statusLocked: !(canEdit || (r.convertedAfter && !r.claimedById)) || this.busy,
            showStatusOnlySave: !mine && !adminEdit && r.convertedAfter && !r.claimedById,
            hasAccountLink: r.isContactLinked && !!r.contactAccountId,
            noAccountLink: !(r.isContactLinked && !!r.contactAccountId),
            showContactOpps: r.isContactLinked,
            showProjectDetails: !r.isContactLinked,
            hasCampaign: !!r.campaign,
            campaignCardCls: 'ldr-campaign-card ldr-campaign-card-' + (r.campaign ? r.campaign.kind : 'none'),
            campaignLabel: r.campaign ? r.campaign.label : '',
            campaignTitle: r.campaign ? r.campaign.title : '',
            campaignBody: r.campaign ? r.campaign.body : '',
            hasUtmContent: !!s.UTM_Content__c,
            expectedCampaignType: expectedCampaignType(s),
            hasExpectedCampaign: !!expectedCampaignType(s),
            utmContent: safeDecode(s.UTM_Content__c),
            showTookOverWarning: mine && !!this.tookOverFrom,
            showAssignedBanner: mine && !!r.assignedBy && r.assignedBy !== this.meName,
            assignedByName: r.assignedBy || '',
            notYetLinked: r.isUnlinked,
            ...(() => {
                const show = (key, cond) => !!cond && !this.dismissedAlerts[r.id + ':' + key];
                return {
                    junkVisible: show('junk', !!r.junkReason),
                    convertedAfterVisible: show('convertedAfter', r.convertedAfter),
                    // #152 D: only while the record's Lead Funnel Timestamp is within the last 7 days (blank = hidden)
                    coordWarningVisible: show(
                        'coordWarning',
                        !r.claimedById && !!r.coordinatorId && r.coordinatorId !== this.meId && !!r.funnelTs && r.funnelTs >= daysAgoPacific(COORD_WARNING_DAYS)
                    ),
                    // #152 E: for 24 hours after the claim, until × (kept per user in this browser)
                    tookOverVisible:
                        mine &&
                        !!this.tookOverFrom &&
                        !!this.tookOverAt &&
                        Date.now() - this.tookOverAt < TOOK_OVER_HOURS * 3600000 &&
                        !this.tookOverDismissed[r.id],
                    assignedVisible: show('assigned', mine && !!r.assignedBy && r.assignedBy !== this.meName),
                    notYetLinkedVisible: show('notYetLinked', r.isUnlinked && !r.junkReason),
                    staleStatusVisible: show('staleStatus', !r.claimedById && this.isStaleStatus(r)),
                    decidedStatusVisible: show('decidedStatus', !r.claimedById && DECIDED_STATUSES.includes(r.leadStatus)),
                    needsStatusVisible: show('needsStatus', mine && r.leadStatus === 'New')
                };
            })(),
            ...(() => {
                // Uses the Lead's / Contact's geocoded address (Salesforce fills Latitude/Longitude).
                const lat = r.isContactLinked ? contact.MailingLatitude : lead.Latitude;
                const lon = r.isContactLinked ? contact.MailingLongitude : lead.Longitude;
                const sr = nearestShowroom(lat, lon);
                return {
                    hasNearbyShowroom: !!sr,
                    nearbyShowroomName: sr ? sr.name : '',
                    nearbyShowroomMiles: sr ? sr.miles : 0,
                    nearbyShowroomAddress: sr ? sr.address : ''
                };
            })(),
            hasLinkedRecord: !r.isUnlinked,
            canLogCall: mine && !r.isUnlinked,
            // Canvas shows Log a call on every linked record; the Apex only logs for the claimer, so it is greyed out otherwise.
            logCallDisabled: this.busy || !mine,
            logCallTitle: mine ? 'Log a call on the ' + recObj : 'Claim it first to log a call',
            outreachLabel: (() => {
                const seq = ((r.followUp || {}).Outreach_Current_Active_Sequence_Name__c || '').trim();
                return seq ? seq + (r.outreach ? ' · ' + r.outreach : '') : r.outreach || '';
            })(),
            // Junk (canvas dd24): Form Submissions and custom instant estimates (not configurator rows or prospects).
            canMarkJunk: !r.isConfigurator && !r.isProspect && !r.junkReason && (!r.claimedById || mine),
            // Status buttons + Junk ▾ in LDR fields (canvas d84b, #94B / #95). Hidden on prospects.
            showStatusRow: !r.isProspect && !r.isConfigurator,
            // #157: header line 3 = status buttons and/or "In Outreach" (prospects without Outreach have none)
            showHeaderLine3: (!r.isProspect && !r.isConfigurator) || !!r.outreach,
            statusButtons: QUICK_STATUSES.map((v) => {
                if (r.isUnlinked) {
                    // v6g7: Working / Unreachable / Disqualified as a "#<status>" tag until a Lead / Contact is linked
                    const why = !UNLINKED_STATUSES.includes(v)
                        ? 'No Lead or Contact linked yet'
                        : r.junkReason
                          ? 'Marked as junk'
                          : r.claimedById && !mine
                            ? 'Claimed by ' + (r.claimedByName || 'someone else')
                            : '';
                    const on = !why && r.unlinkedStatus === v;
                    return {
                        key: v,
                        value: v,
                        label: v,
                        off: !!why || this.busy,
                        title: why || 'No Lead or Contact yet: adds #' + v + ' to Comments' + (r.claimedById ? '' : ' and claims it') +
                            (UNLINKED_DONE.includes(v) ? '; it moves to Finished' : ''),
                        cls: 'ldr-status-btn' + (why ? ' ldr-status-btn-off' : on ? ' ldr-status-btn-on' : '')
                    };
                }
                const why = !mine && !adminEdit
                      ? 'Claim it first'
                      : r.isContactLinked && v === 'Disqualified'
                        ? 'Contacts have no Disqualified status'
                        : '';
                const on = !why && (r.leadStatus || '') === v;
                return {
                    key: v,
                    value: v,
                    label: v,
                    off: !!why || this.busy,
                    title: why || 'Set ' + (r.isContactLinked ? 'Lead Funnel Status' : 'Status') + ' to ' + v + ' and Lead Funnel Timestamp to today',
                    cls: 'ldr-status-btn' + (why ? ' ldr-status-btn-off' : on ? ' ldr-status-btn-on' : '')
                };
            }),
            ...(() => {
                const ok = !r.isConfigurator && !r.isProspect && !r.junkReason && (!r.claimedById || mine);
                return {
                    junkOff: !ok || this.busy,
                    junkBtnCls: 'ldr-status-btn' + (ok ? '' : ' ldr-status-btn-off'),
                    junkTitle: r.junkReason ? 'Already marked as junk' : ok ? 'Mark as junk' : 'Claimed by ' + (r.claimedByName || 'someone else'),
                    junkMenuNote: r.isUnlinked
                        ? 'Claims it and moves it to Finished. No Lead or Contact is created or changed.'
                        : 'Claims it and moves it to Finished. Sets the ' + recObj + '’s Project Coordinator to you, Status to Wrong profile, Lead Funnel Timestamp to today, and Outcome from the reason (Spam/Solicitation, Invalid Contact Information or Other).'
                };
            })(),
            isJunk: !!r.junkReason,
            junkReason: r.junkReason || '',
            junkBy: r.claimedByName || '',
            junkWhen: r.claimedAt ? claimTimeLabel(r.claimedAt) : '',
            tookOverFrom: this.tookOverFrom,
            linkMismatch,
            linkedLeadName: rec.name,
            locationLine,
            // The org's existing Eloqua profiler pages: Profiler_Lead / Profiler_Contact.
            profilerSrc: (r.isContactLinked ? '/apex/LDR_Profiler_Contact?id=' : '/apex/LDR_Profiler_Lead?id=') + r.recordId,
            showWindfall: isHomeowner,
            windfallFromLead: !!wf.__fromLead,
            windfallFacts,
            windfallEmpty,
            showPopulateProject: !r.isContactLinked && !r.isUnlinked,
            contactLine: [r.email, r.phone].filter(Boolean).join(' · '),
            // Canvas whenOf: "N min ago" / "N hr ago" within a day, else the date (Pacific).
            // canvas #156 B: header line 1 of a claimed record = "Claimed Oct 25, 2026, 2:56 PM" (Pacific)
            headerWhen: r.claimedById && r.claimedAt ? 'Claimed ' + claimTimeLabel(r.claimedAt) : 'Submitted ' + relWhen(r.submitted),
            // Canvas: attachment links expire ~30 days after submission; warn in the last 7 days.
            attachmentsDaysLeft: attachDaysLeft(r.submitted),
            attachmentsExpiring: attachments.length > 0 && attachDaysLeft(r.submitted) <= 7,
            typeCls: 'ldr-tag ' + (TYPE_CLASS[r.customerType] || 'ldr-type-unknown'),
            // Canvas f123 (#89A): the header's customer type pill uses the queue-card type colours.
            typePillCls: 'ldr-tag ldr-type-pill ' + (TYPE_CLASS[r.customerType] || 'ldr-type-unknown'),
            facts,
            comments,
            hasComments: !!comments,
            commentsDisplay: comments ? '“' + comments + '”' : '',
            attachments,
            hasAttachments: attachments.length > 0,
            attachmentCount: attachments.length,
            // Keyed by position: two identical messages would otherwise collide as for:each keys.
            mismatches: mismatches.map((text, i) => ({ key: 'mm' + i, text })),
            hasMismatch: mismatches.length > 0,
            mismatchVisible: mismatches.length > 0 && !this.dismissedAlerts[r.id + ':mismatch'],
            tracking: [
                { k: 'UTM source', v: s.UTM_Source__c || '—' },
                { k: 'Medium', v: s.UTM_Medium__c || '—' },
                { k: 'Campaign', v: safeDecode(s.UTM_Campaign__c) || '—' },
                { k: 'Term', v: safeDecode(s.UTM_Term__c) || '—' }
            ],
            playbackUrl: s.Playback_URL__c,
            hasPlayback: !!s.Playback_URL__c,
            hasOutreach: !!r.outreach,
            // 3D configurator prospects have no record with claim fields yet (KBMax_Web_Quote__c).
            canClaim: !r.claimedById && !(r.isConfigurator && !this.configuratorClaimable),
            isMine: mine,
            isOthers: !!r.claimedById && !mine,
            locked: !canEdit || this.busy,
            notMine: !canEdit,
            showCoordWarning,
            showStaleNurture: !r.claimedById && this.isStaleStatus(r),
            showDecidedStatusWarning: !r.claimedById && DECIDED_STATUSES.includes(r.leadStatus),
            needsStatusUpdate: mine && r.leadStatus === 'New',
            coordMismatch: coordIsOther,
            coordIsMe: !!r.coordinatorId && r.coordinatorId === this.meId,
            coordinatorLabel: r.coordinatorName || 'Unassigned',
            coordCls: 'ldr-field-v' + (coordIsOther ? ' ldr-warn-text' : ''),
            hasMatchedAccount: !!r.matchedAccountId && !r.isContactLinked,
            matchedAccountName: ma ? ma.Name : '',
            matchedOppCount: countLabel(lead.Matched_Account_Opportunity_Count__c),
            matchedOrderCount: countLabel(lead.Matched_Account_Order_Count__c),
            matchedFunnelStage: lead.Matched_Account_Funnel_Stage__c || '—',
            matchedIsCompetitor: !!lead.Matched_Account_Competitor__c,
            ...(() => {
                // Display-only routing (repRouting.js). The Salesforce owner itself is unchanged.
                const route = resolveRepDisplay(this.routeInput(r, rec.state, rec.zip));
                const shown = route.name || r.owner;
                // canvas #152 C / #153 B: the rule line under the rep is gone; a short note follows the name instead.
                const note = repNoteFor(route, r.owner);
                return {
                    repDisplay: route.name || 'Not determinable',
                    repCls: !route.name ? 'ldr-error-text' : route.flagged ? 'ldr-warn-text' : '',
                    hasRepNote: !!note.text,
                    repNote: note.text,
                    repNoteUndetermined: note.undetermined,
                    repNoteCls: 'ldr-rep-note' + (!route.name ? ' ldr-error-text' : route.flagged ? ' ldr-rep-note-flag' : ''),
                    repRuleTitle: route.rule + (route.note ? ': ' + route.note : ''),
                    ownerFirst: shown && shown !== 'Unassigned' ? shown.split(' ')[0] : 'rep'
                };
            })(),
            telHref: r.phone ? 'tel:' + r.phone.replace(/[^0-9+]/g, '') : null,
            emailSubject: email.subject,
            emailBody: email.body,
            mailtoHref: r.email
                ? 'mailto:' +
                  r.email +
                  '?subject=' +
                  encodeURIComponent(email.subject) +
                  '&bcc=' +
                  encodeURIComponent(LDR_BCC) +
                  '&body=' +
                  encodeURIComponent(email.body)
                : null,
            ldrBcc: LDR_BCC
        };
    }

    get hasActive() {
        return !!this.active;
    }

    /** #161: the alert group between the header and the status-button line renders only when a banner is showing. */
    get detailHasAlerts() {
        const a = this.active;
        return (
            !!a &&
            (this.conflictVisible ||
                [
                    a.noOutreachVisible,
                    a.convertedAfterVisible,
                    a.coordWarningVisible,
                    a.junkVisible,
                    a.tookOverVisible,
                    a.assignedVisible,
                    a.notYetLinkedVisible,
                    a.staleStatusVisible,
                    a.decidedStatusVisible,
                    a.mismatchVisible,
                    a.needsStatusVisible
                ].some(Boolean))
        );
    }

    get hasRelated() {
        return this.related.length > 0;
    }

    get hasHiddenFields() {
        return this.hiddenFields.length > 0;
    }

    get hiddenFieldsLabel() {
        return this.hiddenFields.join(', ');
    }

    /**
     * v5.7: the page-level banners, each closable with ×. A closed banner stays closed until the page is reloaded, or
     * until what it says changes (another error, a different count). The hidden-fields banner is for the inbox admins
     * only (was every LDR).
     */
    get topVisible() {
        const banners = {
            legacyMove: [this.showLegacyMove, this.legacyMoveText],
            uncontacted: [this.showUncontacted, this.uncontactedCount],
            boss: [this.bossView, 'on'],
            viewAs: [this.viewingAsOther, this.viewAsId],
            linkFix: [this.showLinkFixError, this.linkFixError],
            estimateError: [this.showEstimateError, this.estimateError],
            estimatesOff: [this.showEstimatesOffNotice, 'on'],
            hiddenFields: [this.isAdmin && this.hasHiddenFields, this.hiddenFieldsLabel],
            loadError: [!!this.loadError, this.loadError]
        };
        const out = {};
        Object.keys(banners).forEach((k) => {
            const [show, says] = banners[k];
            out[k] = !!show && this.dismissedTop[k] !== String(says);
        });
        return out;
    }

    dismissTop(e) {
        const key = e.currentTarget.dataset.key;
        const says = {
            legacyMove: this.legacyMoveText,
            uncontacted: this.uncontactedCount,
            boss: 'on',
            viewAs: this.viewAsId,
            linkFix: this.linkFixError,
            estimateError: this.estimateError,
            estimatesOff: 'on',
            hiddenFields: this.hiddenFieldsLabel,
            loadError: this.loadError
        };
        if (!Object.prototype.hasOwnProperty.call(says, key)) return;
        this.dismissedTop = { ...this.dismissedTop, [key]: String(says[key]) };
    }

    get hasHistory() {
        return this.history.length > 0;
    }

    get noHistory() {
        return this.timelineLoaded && this.history.length === 0;
    }

    get hasActivity() {
        return this.activity.length > 0;
    }

    get noActivity() {
        return this.timelineLoaded && this.activity.length === 0;
    }

    get historyShown() {
        return this.historyExpanded ? this.history : this.history.slice(0, PREVIEW_COUNT);
    }

    get hasMoreHistory() {
        return this.history.length > PREVIEW_COUNT;
    }

    get historyToggleLabel() {
        return this.historyExpanded ? 'Show Less' : '+' + (this.history.length - PREVIEW_COUNT) + ' More';
    }

    get activityShown() {
        return this.activityExpanded ? this.activity : this.activity.slice(0, PREVIEW_COUNT);
    }

    get hasMoreActivity() {
        return this.activity.length > PREVIEW_COUNT;
    }

    get activityToggleLabel() {
        return this.activityExpanded ? 'Show Less' : '+' + (this.activity.length - PREVIEW_COUNT) + ' More';
    }

    get noAccountOpps() {
        return !this.hasAccountOpps;
    }

    get hasAccountOpps() {
        return this.accountOpps.length > 0;
    }

    get moreOppsCount() {
        return this.account ? Math.max(0, this.account.opportunityTotal - this.accountOpps.length) : 0;
    }

    get hasMoreOpps() {
        return this.moreOppsCount > 0;
    }

    get matchedLocation() {
        const a = this.account;
        return a && (a.city || a.state) ? [a.city, a.state].filter(Boolean).join(', ') : 'Not provided';
    }

    get matchedWebsite() {
        return (this.account && this.account.website) || 'Not provided';
    }

    /** Other (non-Representative) submissions from the same email, with claim status. */
    get personOthers() {
        return this.person
            .filter((p) => !isRepContact(p.inquiryType))
            .map((p) => {
                const inQueue = this.rows.some((x) => x.id === p.recordId);
                const claimed = !!p.claimedById;
                const comment = (p.comments || '').trim();
                const preview = p.projectName || (comment.length > 70 ? comment.slice(0, 67) + '…' : comment);
                const activeRow = this.rows.find((x) => x.id === this.activeId);
                const gapMins = activeRow
                    ? Math.round(Math.abs(new Date(activeRow.submitted) - new Date(p.submittedAt)) / 60000)
                    : null;
                return {
                    ...p,
                    key: p.recordId,
                    preview,
                    hasPreview: !!preview,
                    gapLabel: gapMins === null ? '' : gapLabel(gapMins),
                    kind: p.inquiryType || 'Form Submission',
                    kindCls: inquiryCls(p.inquiryType),
                    claimLabel: claimed ? 'Claimed by ' + (p.claimedById === this.meId ? 'you' : p.claimedByName) : 'Unclaimed',
                    claimCls: claimed ? 'ldr-muted ldr-small' : 'ldr-small ldr-error-text ldr-strong',
                    jumpLabel: claimed || !inQueue ? 'View' : 'Jump & claim →',
                    jumpCls: claimed || !inQueue ? 'ldr-muted ldr-small' : 'ldr-small ldr-link-green ldr-strong',
                    whenLabel: relWhen(p.submittedAt)
                };
            });
    }

    get hasPersonOthers() {
        return this.personOthers.length > 0;
    }

    /** The most recent Representative request from the same person (excluded from the queue). */
    get repFlag() {
        const a = this.active;
        const reps = this.person.filter((p) => isRepContact(p.inquiryType));
        if (!a || reps.length === 0) return null;
        const rep = reps.reduce((best, x) => {
            return !best || new Date(x.submittedAt) > new Date(best.submittedAt) ? x : best;
        }, null);
        const gap = Math.round(Math.abs(new Date(a.submitted) - new Date(rep.submittedAt)) / 60000);
        const label =
            gap < 60 ? gap + ' min' : gap < 1440 ? Math.round(gap / 60) + ' hr' : Math.round(gap / 1440) + ' day' + (Math.round(gap / 1440) === 1 ? '' : 's');
        const isLong = gap > LONG_REP_GAP_MINUTES;
        return {
            whenLabel: when(rep.submittedAt),
            gapPhrase: label + (isLong ? ' before this submission' : ' apart'),
            isLong,
            cls: 'ldr-banner ' + (isLong ? 'ldr-banner-warn' : 'ldr-banner-neutral')
        };
    }

    get hasRepFlag() {
        return !!this.repFlag;
    }

    get activeIsContact() {
        const r = this.rows.find((x) => x.id === this.activeId);
        return !!(r && r.isContactLinked);
    }

    get statusOptions() {
        // Contact.Lead_Funnel_Status__c can be blank; Lead.Status can't.
        if (this.activeIsContact) {
            return [{ label: '--None--', value: '' }, ...this.contactStatusValues.map((v) => ({ label: v, value: v }))];
        }
        return this.statusValues.map((v) => ({ label: v, value: v }));
    }

    /**
     * Wrong profile / Disqualified: Lead Funnel Outcome is shown with a * and "Required when Status is …" as a prompt,
     * but it isn't enforced: saving without it still works (Aqil, 2026-10-21). Status Reason isn't edited in the inbox
     * any more: on Leads it depends on Status and production maps no reason to Wrong profile / Disqualified.
     */
    get outcomeFlagged() {
        // v6g8 (Aqil): only while it's needed: the Outcome is still blank and the status change isn't saved yet
        const a = this.active;
        const saved = !!a && (a.leadStatus || '') === (this.draft.status || '');
        return (this.draft.status === WRONG_PROFILE || this.draft.status === 'Disqualified') && !this.draft.outcome && !saved;
    }

    get outcomeLabel() {
        return this.outcomeFlagged ? 'Lead Funnel Outcome *' : 'Lead Funnel Outcome';
    }

    get outcomeFlagText() {
        return 'Required when Status is ' + this.draft.status + '.';
    }

    get outcomeOptions() {
        const vals = this.activeIsContact ? this.contactOutcomeValues : this.outcomeValues;
        return [{ label: '--None--', value: '' }, ...vals.map((v) => ({ label: v, value: v }))];
    }

    get callOutcomes() {
        return CALL_OUTCOMES.map((c) => ({ key: c, label: c, cls: 'ldr-call-oc' + (this.callOutcome === c ? ' ldr-call-oc-on' : '') }));
    }

    get callSaveOff() {
        return !this.callOutcome || this.busy;
    }

    get callSaveTitle() {
        return this.callOutcome ? 'Create the call log' : 'Pick how the call went first';
    }

    get callSaveCls() {
        return 'ldr-btn ldr-call-save' + (this.callOutcome ? '' : ' ldr-call-save-off');
    }

    handleCallNotes(e) {
        this.callNotes = e.detail && e.detail.value !== undefined ? e.detail.value : e.target.value;
    }

    /** #160: the button is sized to its text. v5.7: Leads only (Contacts get Attach to Opportunity there). */
    get handoffLabel() {
        return 'Convert/Hand-off';
    }

    get hasContactOpps() {
        return this.contactOpps.length > 0;
    }

    get noContactOpps() {
        return this.contactOpps.length === 0;
    }

    // ------------------------------------------------------------ selection & draft

    selectRow(id) {
        this.activeId = id;
        this.dismissedAlerts = {};
        this.quickEditOpen = false;
        this.resetQuickEdit();
        this.junkMenuOpen = false;
        this.lightboxIndex = null;
        this.projectDetailsOpen = false; // every lead opens with Project Details collapsed
        this.autoFilled = {};
        this.loggingCall = false;
        this.conflictMsg = undefined;
        this.message = undefined;
        this.activityPreview = null;
        this.confirm = null;
        this.creatingLead = false;
        this.relatedExpanded = false;
        this.sixSenseDraft = null;
        this.emailCopied = null;
        this.emailTemplate = '';
        this.callOutcome = '';
        this.callNotes = '';
        this.convertState = null;
        this.attachOpp = null;
        this.claimCtx = null;
        this.preBase = {};
        this.resetDraft();
        this.cfgQuotesAll = false;
        this._relatedFor = id;
        this.saveView();
        this.loadSelectionData();
    }

    /** Side data for the selected row: related items / timeline / claim context, configurator quotes, email match. */
    loadSelectionData() {
        this.loadRelated();
        const row = this.rows.find((x) => x.id === this.activeId);
        if (row && row.isConfigurator) this.loadConfigDetail(row);
        this.emailMatch = null;
        if (row && row.isUnlinked && row.email && !row.isConfigurator) this.loadEmailMatch(row);
    }

    /** Not linked yet: does a Lead / Contact already exist with this email? (canvas 12d4; unconverted Leads only) */
    async loadEmailMatch(row) {
        try {
            const sugg = (await getLinkSuggestionsApex({ submissionId: row.id, name: null })) || [];
            if (this.activeId !== row.id) return;
            const same = sugg.filter((x) => x.why === 'Same email');
            const hasLead = same.some((x) => x.kind === 'Lead');
            const hasContact = same.some((x) => x.kind === 'Contact');
            const text = hasLead && hasContact
                ? 'A Lead and a Contact exist with this email address.'
                : hasContact ? 'A Contact exists with this email address.' : hasLead ? 'A Lead exists with this email address.' : '';
            this.emailMatch = text ? { id: row.id, text } : null;
        } catch {
            if (this.activeId === row.id) this.emailMatch = null;
        }
    }

    get emailMatchText() {
        return this.emailMatch && this.emailMatch.id === this.activeId ? this.emailMatch.text : '';
    }

    saveView() {
        writeView({ tab: this.tab, activeId: this.activeId, sortOrder: this.sortOrder });
    }

    resetDraft() {
        const r = this.rows.find((x) => x.id === this.activeId);
        if (!r) {
            this.draft = { status: '', outcome: '', project: '', notes: '', pre: {} };
            this.draftBase = { status: '', outcome: '', pre: {} };
            return;
        }
        const s = r.raw;
        const lead = s.Lead__r || {};
        const projectName = lead.Project_Name__c || s.Project_Name__c || '';
        const pre = {};
        if (!r.isContactLinked && !lead.Project_Name__c && s.Project_Name__c) {
            // Lead has no Project Name yet: carry over what the customer typed on the form.
            pre.Project_Name__c = s.Project_Name__c;
        }
        this.draft = {
            status: r.leadStatus,
            outcome: r.leadOutcome,
            // LDR Project Name defaults to Project Name until the LDR edits it.
            project: r.ldrProject || projectName,
            notes: r.ldrNotes,
            pre
        };
        // What "no unsaved changes" means for this row (the carried-over form Project Name counts as unchanged).
        this.draftBase = { status: r.leadStatus, outcome: r.leadOutcome, pre: { ...pre } };
    }

    async loadRelated() {
        const r = this.rows.find((x) => x.id === this.activeId);
        this.related = [];
        this.person = [];
        this.account = null;
        this.accountOpps = [];
        this.contactOpps = [];
        this.history = [];
        this.activity = [];
        this.timelineLoaded = false;
        this.showEmailPreview = false;
        this.historyExpanded = false;
        this.activityExpanded = false;
        if (!r) return;
        this.loadTimeline(r);
        this.loadClaimContext(r);
        if (r.isContactLinked) this.loadContactOpps(r);
        if (r.matchedAccountId && !r.isContactLinked) {
            getAccountSummary({ accountId: r.matchedAccountId })
                .then((acct) => {
                    if (this.activeId !== r.id) return;
                    this.account = acct;
                    this.accountOpps = ((acct && acct.opportunities) || []).map((o) => {
                        const tone = stageTone(o.status);
                        return {
                            ...o,
                            key: o.recordId,
                            cardCls: 'ldr-opp ldr-opp-' + tone,
                            stageCls: 'ldr-stage ldr-stage-' + tone,
                            amountLabel: o.amount || '—',
                            createdLabel: o.createdDate ? new Date(o.createdDate).toLocaleDateString() : '—',
                            closeLabel: o.closeDate ? new Date(o.closeDate + 'T00:00:00').toLocaleDateString() : '—'
                        };
                    });
                })
                .catch(() => {
                    if (this.activeId === r.id) this.account = null;
                });
        }
        if (r.email) {
            getPersonSubmissions({ email: r.email, excludeSubmissionId: r.isConfigurator ? null : r.id })
                .then((items) => {
                    if (this.activeId === r.id) this.person = items || [];
                })
                .catch(() => {
                    if (this.activeId === r.id) this.person = [];
                });
        }
        try {
            const items = await getRelated({
                leadId: r.leadId || null,
                contactId: r.isContactLinked ? r.contactId : null,
                excludeId: r.isEstimate ? r.id : null
            });
            if (this.activeId !== r.id) return; // selection changed meanwhile
            // Newest first; the card shows RELATED_PAGE and "Load more" reveals the rest.
            const sorted = (items || []).slice().sort((x, y) => (toTime(y.createdDate) || 0) - (toTime(x.createdDate) || 0));
            this.related = sorted.map((i) => ({
                ...i,
                key: i.recordId,
                kindCls: 'ldr-tag ' + (i.source === 'kbmax' ? 'ldr-rel-kind-kbmax' : 'ldr-rel-kind-est'),
                amountLabel: i.source === 'kbmax' ? 'KBMax price' : 'Estimate range',
                amountText: i.amount || '—',
                hasStatus: !!i.status,
                hasNote: !!i.note,
                whenLabel: new Date(i.createdDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
            }));
        } catch {
            // A late failure for the previously selected row must not clear the current row's data.
            if (this.activeId === r.id) this.related = [];
        }
    }

    /** The Contact's open opportunities (Open opportunities card, FETR). Returns the list, or [] if the row changed / failed. */
    async loadContactOpps(r) {
        try {
            const items = await getContactOpportunities({ contactId: r.contactId });
            if (this.activeId !== r.id) return [];
            this.contactOpps = (items || []).map((o) => ({
                ...o,
                key: o.recordId,
                cardCls: 'ldr-copp ldr-copp-' + stageTone(o.status),
                stageCls: 'ldr-stage ldr-stage-' + stageTone(o.status),
                amountLabel: o.amount || '—',
                createdLabel: o.createdDate ? new Date(o.createdDate).toLocaleDateString() : '—',
                closeLabel: o.closeDate ? new Date(o.closeDate + 'T00:00:00').toLocaleDateString() : '—',
                ownerLabel: o.owner || '—',
                projectOwnerLabel: o.projectOwner || '—',
                // canvas aabc (#96C): Opportunity owner and Project owner both set and different
                isSplit: !!(o.projectOwner && o.owner && o.projectOwner !== o.owner),
                typeLabel: o.recordType || '—'
            }));
            return this.contactOpps;
        } catch {
            if (this.activeId === r.id) this.contactOpps = [];
            return [];
        }
    }

    /** If I claimed this and the claim replaced another coordinator, remember who and when (take-over reminder). */
    async loadClaimContext(r) {
        this.tookOverFrom = null;
        this.tookOverAt = null;
        this.claimCtx = null;
        if (r.claimedById !== this.meId || r.isUnlinked) return;
        try {
            const ctx = await getClaimContext({ submissionId: r.id });
            if (this.activeId !== r.id) return;
            this.tookOverFrom = (ctx && ctx.tookOverFrom) || null;
            this.tookOverAt = ctx && ctx.claimedAt ? toTime(ctx.claimedAt) : null;
            this.claimCtx = ctx ? { ...ctx, submissionId: r.id } : null;
        } catch {
            if (this.activeId !== r.id) return;
            this.tookOverFrom = null;
            this.tookOverAt = null;
            this.claimCtx = null;
        }
    }

    /** localStorage key for this user's take-over dismissals (#152 E). */
    get tookOverStoreKey() {
        return TOOK_OVER_STORE_PREFIX + (this.meId || '');
    }

    /** Reads this user's dismissed take-over reminders, dropping ones older than a few days. Storage may be blocked. */
    loadTookOverDismissed() {
        let saved = {};
        try {
            saved = JSON.parse(window.localStorage.getItem(this.tookOverStoreKey) || '{}') || {};
        } catch {
            saved = {};
        }
        const cutoff = Date.now() - TOOK_OVER_KEEP_DAYS * DAY_MS;
        this.tookOverDismissed = Object.fromEntries(Object.entries(saved).filter(([, at]) => typeof at === 'number' && at >= cutoff));
    }

    /** × on the take-over reminder (#152 E): hides it for this submission, on every tab, and remembers that. */
    dismissTookOver() {
        if (!this.activeId) return;
        this.tookOverDismissed = { ...this.tookOverDismissed, [this.activeId]: Date.now() };
        try {
            window.localStorage.setItem(this.tookOverStoreKey, JSON.stringify(this.tookOverDismissed));
        } catch {
            // storage blocked: the reminder stays hidden until the page reloads
        }
    }

    async loadTimeline(r) {
        try {
            const t = await getLeadTimeline({ leadId: r.recordId });
            if (this.activeId !== r.id) return;
            this.history = (t.history || []).map((h) => ({
                ...h,
                oldLabel: h.oldValue || '(blank)',
                newLabel: h.newValue || '(blank)',
                isCreated: h.label === 'Lead created' || h.label === 'Contact created',
                whenLabel: when(h.happenedAt)
            }));
            this.activity = (t.activity || []).map((x) => {
                const isSystem = AUTOMATION_USERS.includes(x.who);
                const kind = ['call', 'email', 'event'].includes(x.kind) ? x.kind : 'task';
                return {
                    ...x,
                    isSystem,
                    kind,
                    iconName: { call: 'standard:log_a_call', email: 'standard:email', event: 'standard:event', task: 'standard:task' }[kind],
                    kindLabel: { call: 'Call', email: 'Email', event: 'Event', task: 'Task' }[kind],
                    rowCls: 'ldr-activity-row ' + (isSystem ? 'ldr-activity-system' : 'ldr-activity-person'),
                    whoCls: isSystem ? 'ldr-muted ldr-small' : 'ldr-small ldr-strong',
                    whenLabel: when(x.happenedAt)
                };
            });
        } catch {
            if (this.activeId !== r.id) return;
            this.history = [];
            this.activity = [];
        } finally {
            // Only the current row's request ends the loading state (a stale reply used to show "No history" early).
            if (this.activeId === r.id) this.timelineLoaded = true;
        }
    }

    // ------------------------------------------------------------ handlers

    /**
     * canvas #128: every list filter back to All and the Date sort to newest first; only the search is kept
     * (it is highlighted while active, so it's obvious the list is filtered).
     */
    resetListFilters() {
        this.seqFilter = 'all';
        this.dismissedAlerts = {};
        this.statusFilter = 'All';
        this.recTypeFilter = 'All';
        this.recordFilter = 'All';
        this.formFilter = 'All';
        this.unclaimedCoordFilter = 'All';
        this.coordinatorFilter = 'All';
        this.prospectCoordFilter = 'All';
        this.sortOrder = 'newest';
        this.message = undefined;
    }

    /**
     * canvas #143: open a record / Post Quote reply in its tab: the tab click's resets (the search is kept), plus
     * extra.prospectList (Prospects) or extra.pqFilter (Post Quote) so the target is in the list.
     */
    jumpTo(tab, id, extra) {
        const x = extra || {};
        this.userTab = 'inbox';
        if (this.bossView) this.bossTab = 'inbox';
        this.tab = tab;
        this.resetListFilters();
        if (x.prospectList) this.prospectList = x.prospectList;
        if (x.pqFilter) this.pqFilter = x.pqFilter;
        if (tab === 'prospects' && !this.prospectsLoaded && !this.prospectsLoading) this.loadProspects();
        if (tab === 'sixsense') {
            // #151 H: ldrSixSense opens the person in the right box (Mine / Unassigned)
            this.ssFocus = { key: id, box: x.ssBox || 'mine', nonce: Date.now() };
            this.saveView();
        } else if (isPqKey(id)) {
            const c = { ...this.pqCollapsed };
            delete c[id];
            this.pqCollapsed = c;
            this.activeId = id;
            this.saveView();
        } else if (id && id !== this.activeId) {
            this.selectRow(id);
        } else {
            this.saveView();
        }
    }

    /** canvas #143: search matches outside the current list (other tabs, or this tab hidden by a filter). */
    get crossTab() {
        const q = this.listQuery.toLowerCase();
        const empty = { has: false, items: [], count: 0, more: false, moreLabel: '', query: '' };
        if (!q || this.isBossAllSubs) return empty;
        const key = [q, this.tab, this.prospectList, this.pqFilter, this.unclaimedCoordFilter, this.coordinatorFilter, this.recordFilter,
            this.formFilter, this.seqFilter, this.recTypeFilter, this.statusFilter, this.prospectCoordFilter, this.viewerId, this.xtAllFor].join('|');
        const c = this._xtCache;
        if (c && c.rows === this.rows && c.pq === this.pqRows && c.ss === this.ssData && c.key === key) return c.value;
        const hit = (v) => (v || '').toLowerCase().includes(q);
        const now = Date.now();
        const out = [];
        this.rows.forEach((r) => {
            if (!(hit(r.name) || hit(r.email)) || this.isShownInList(r)) return;
            const here = this.inTab(r, this.tab) && !(this.tab === 'prospects' && r.prospectList !== this.prospectList);
            const t = here ? this.tab : this.homeTabOf(r);
            if (!t) return;
            out.push({
                key: r.id,
                id: r.id,
                tab: t,
                order: XT_ORDER.indexOf(t),
                at: now - (r.ageMin || 0) * 60000,
                name: r.name || r.email,
                email: r.email || '',
                tabTag: here ? 'This Tab · Filtered Out'
                    : 'In ' + TAB_LABEL[t] + (t === 'prospects' && r.prospectList === 'configurator' ? ' (3D Configurator)' : ''),
                sub: this.xtSub(r),
                cls: 'ldr-xt ' + (TYPE_CLASS[r.customerType] || 'ldr-type-unknown'),
                prospectList: t === 'prospects' ? r.prospectList : '',
                pqFilter: ''
            });
        });
        const listed = new Set((this.tab === 'postquote' ? this.pqListRows : []).concat(this.pqTail).map((r) => r.key));
        this.pqRows.forEach((r) => {
            if (!(hit(r.name) || hit(r.email) || hit(r.projectName)) || listed.has(r.key)) return;
            const t = this.pqHomeTab(r);
            if (!t) return;
            out.push({
                key: r.key,
                id: r.key,
                tab: t,
                order: XT_ORDER.indexOf(t),
                at: toTime(r.done ? r.done.at : r.latestAt) || 0,
                name: r.name,
                email: r.email || '',
                tabTag: t === this.tab ? 'This Tab · Filtered Out' : 'In ' + TAB_LABEL[t],
                sub: 'Post Quote reply · ' + (r.projectName || '') + (r.coordinator ? ' · ' + r.coordinator : ''),
                cls: 'ldr-xt ' + (TYPE_CLASS[r.customerType] || 'ldr-type-unknown'),
                prospectList: '',
                pqFilter: t === 'postquote' ? this.pqFilterFor(r) : ''
            });
        });
        if (this.tab !== 'sixsense') out.push(...this.ssSearchItems((p) => hit(p.name) || hit(p.email)));
        out.sort((a, b) => a.order - b.order || b.at - a.at);
        const all = this.xtAllFor === q;
        const value = {
            has: out.length > 0,
            items: all ? out : out.slice(0, XT_CAP),
            count: out.length,
            more: out.length > XT_CAP && !all,
            moreLabel: 'Show all ' + out.length,
            query: this.searchQuery.trim()
        };
        this._xtCache = { rows: this.rows, pq: this.pqRows, ss: this.ssData, key, value };
        return value;
    }

    /** Grey line of a cross-tab / "In the inbox" match: form · customer type · who has it. */
    xtSub(r) {
        return [r.form, r.customerType, r.claimedById ? 'Claimed by ' + (r.claimedByName || 'another LDR') : r.isProspect ? 'Prospect' : 'Unclaimed']
            .filter(Boolean)
            .join(' · ');
    }

    handleCrossTab(e) {
        const d = e.currentTarget.dataset;
        this.jumpTo(d.tab, d.id, { prospectList: d.list || null, pqFilter: d.pqf || null, ssBox: d.box || null });
    }

    /**
     * #151 H: 6Sense people matching a search, for "In other tabs" and "In the inbox" (admins only, as #152 A):
     * Mine or Unassigned box only. hit(person) decides the match.
     */
    ssSearchItems(hit) {
        if (!this.showSixSense) return [];
        const out = [];
        this.ssPeople.forEach((p) => {
            const box = this.ssBoxOf(p);
            if (!box || !hit(p)) return;
            out.push({
                key: 'ss' + p.leadId,
                id: p.leadId,
                leadId: p.leadId,
                tab: 'sixsense',
                order: XT_ORDER.indexOf('sixsense'),
                at: toTime(p.latestAt) || 0,
                name: p.name || p.email,
                email: p.email || '',
                tabTag: 'In 6Sense' + (box === 'unassigned' ? ' (Unassigned)' : ''),
                sub: ['6sense reply', p.ceStatus, p.coordinatorName || 'No Project Coordinator'].filter(Boolean).join(' · '),
                cls: 'ldr-xt ' + (TYPE_CLASS[p.leadType] || 'ldr-type-unknown'),
                prospectList: '',
                pqFilter: '',
                ssBox: box
            });
        });
        return out;
    }

    showAllCrossTab() {
        this.xtAllFor = this.searchQuery.trim().toLowerCase();
    }

    /** Record header "Go to <Tab> Tab" (canvas #143B). */
    goToActiveTab() {
        const a = this.active;
        if (a && a.goTabKey) this.jumpTo(a.goTabKey, a.id, a.goTabList ? { prospectList: a.goTabList } : null);
    }

    /** ldrPostQuote "Go to <Tab> Tab" (canvas #143B). */
    handleGoTab(e) {
        const d = e.detail || {};
        if (d.tab && d.key) this.jumpTo(d.tab, d.key, d.tab === 'postquote' ? { pqFilter: d.pqFilter } : null);
    }

    // ------------------------------------------------------------ Salesforce search (canvas #144 / #145A)

    handleSpText(e) {
        this.spText = e.target.value || '';
    }

    /** canvas #145A: Enter runs the search, like the button. */
    handleSpKey(e) {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        this.spText = e.target.value || '';
        this.runSfSearch();
    }

    async runSfSearch() {
        const t = (this.spText || '').trim();
        if (t.length < 2) {
            this.dispatchEvent(new ShowToastEvent({ title: 'Search Salesforce', message: 'Type at least 2 characters to search Salesforce.', variant: 'warning' }));
            return;
        }
        const seq = ++this._spSeq;
        this.spText = t;
        this.spQuery = t;
        this.spOpen = true;
        this.spLoading = true;
        this.spError = '';
        this.spPeople = [];
        this.spCapped = false;
        try {
            const r = await searchPeopleApex({ term: t });
            if (seq !== this._spSeq) return;
            this.spPeople = r.people || [];
            this.spCapped = !!r.capped;
            this.spError = r.error || '';
        } catch (e) {
            if (seq === this._spSeq) this.spError = errorText(e);
        } finally {
            if (seq === this._spSeq) this.spLoading = false;
        }
    }

    closeSfSearch() {
        this.spOpen = false;
    }

    /** "In the inbox" match: close the panel, then open it in its tab (as #143). */
    handleSpInbox(e) {
        const d = e.currentTarget.dataset;
        this.spOpen = false;
        this.jumpTo(d.tab, d.id, { prospectList: d.list || null, pqFilter: d.pqf || null, ssBox: d.box || null });
    }

    openSpRecord(e) {
        const d = e.currentTarget.dataset;
        this.openRecord(d.id, d.kind);
    }

    /** Salesforce search panel view model (canvas #144). */
    get sp() {
        if (!this.spOpen || !this.spQuery) return { open: false };
        const q = this.spQuery;
        const ql = q.toLowerCase();
        const exact = EMAIL_RE.test(q);
        const hit = (v) => (exact ? (v || '').trim().toLowerCase() === ql : (v || '').toLowerCase().includes(ql));
        const inbox = [];
        const seen = new Set();
        const inInbox = new Set(); // Lead / Contact Ids in some inbox tab (or with a Post Quote reply in one)
        this.rows.forEach((r) => {
            const t = this.homeTabOf(r);
            if (!t) return;
            [r.leadId, r.contactId].filter(Boolean).forEach((id) => inInbox.add(id));
            if (!(hit(r.email) || (!exact && hit(r.name)))) return;
            const k = r.leadId || r.contactId || r.id;
            if (seen.has(k)) return;
            seen.add(k);
            inbox.push({
                key: 'i-' + r.id,
                id: r.id,
                tab: t,
                list: t === 'prospects' ? r.prospectList : '',
                pqf: '',
                name: r.name || r.email,
                email: r.email || '',
                tabTag: 'In ' + TAB_LABEL[t],
                sub: this.xtSub(r),
                cls: 'ldr-xt ' + (TYPE_CLASS[r.customerType] || 'ldr-type-unknown')
            });
        });
        this.pqRows.forEach((r) => {
            const t = this.pqHomeTab(r);
            if (!t) return;
            if (r.contactId) inInbox.add(r.contactId);
            if (!(hit(r.email) || (!exact && hit(r.name)))) return;
            inbox.push({
                key: 'p-' + r.key,
                id: r.key,
                tab: t,
                list: '',
                pqf: t === 'postquote' ? this.pqFilterFor(r) : '',
                name: r.name,
                email: r.email || '',
                tabTag: 'In ' + TAB_LABEL[t],
                sub: 'Post Quote reply · ' + (r.projectName || ''),
                cls: 'ldr-xt ' + (TYPE_CLASS[r.customerType] || 'ldr-type-unknown')
            });
        });
        // #151 H: 6Sense people in the viewer's Mine / Unassigned box (admins only)
        this.ssSearchItems((p) => hit(p.email) || (!exact && hit(p.name))).forEach((x) => {
            inInbox.add(x.leadId);
            if (seen.has(x.leadId)) return;
            seen.add(x.leadId);
            inbox.push({ ...x, key: 'i-' + x.key, list: '', pqf: '' });
        });
        const fmtDay =(v) => (v ? new Date(v).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—');
        const fmtDate = (v) => (v ? new Date(v + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—');
        const sf = this.spPeople
            .filter((p) => !inInbox.has(p.id))
            .map((p) => {
                const typeCls = TYPE_CLASS[p.customerType] || 'ldr-type-unknown';
                const n = p.openOppCount || 0;
                const isC = p.kind === 'Contact';
                return {
                    key: p.id,
                    id: p.id,
                    kind: p.kind,
                    name: p.name,
                    email: p.email || '—',
                    phone: p.phone || '—',
                    cls: 'ldr-sp-card ' + typeCls,
                    typeCls: 'ldr-tag ldr-sp-tag ' + typeCls,
                    customerType: p.customerType || 'Unknown',
                    status: p.status || '(blank)',
                    company: p.company || (isC ? 'No Account' : '—'),
                    hasAccountLink: isC && !!p.accountId,
                    accountId: p.accountId,
                    location: [[p.city, p.state].filter(Boolean).join(', '), p.zip].filter(Boolean).join(' ') || 'No address',
                    rep: aliasOwner(p.owner) || '—',
                    coordinator: p.coordinator || 'No Project Coordinator',
                    coordCls: p.coordinator ? 'ldr-sp-coord' : 'ldr-sp-coord ldr-sp-coord-none',
                    created: fmtDay(p.createdDate),
                    lastActivity: fmtDate(p.lastActivityDate),
                    hasOpp: n > 0,
                    oppLabel: n + ' open opp' + (n === 1 ? '' : 's') + (p.openOppStages && p.openOppStages.length ? ' · ' + p.openOppStages.join(', ') : ''),
                    why: this.whyNotInInbox(p)
                };
            });
        return {
            open: true,
            query: q,
            loading: this.spLoading,
            error: this.spError,
            modeLine: exact
                ? 'Exact email match on Leads (not converted) and Contacts. Finds records created seconds ago.'
                : 'Partial text: Salesforce search across name, email and company. Records created in the last few minutes may not show yet.',
            inbox,
            hasInbox: inbox.length > 0,
            inboxCount: inbox.length,
            sf,
            sfCount: sf.length,
            noSf: !this.spLoading && !this.spError && sf.length === 0,
            noSfText: 'No other Leads or Contacts in Salesforce with this ' + (exact ? 'email' : 'text') + '.',
            footnote: 'Converted Leads are left out (their Contact shows instead).' +
                (this.spCapped ? ' Showing the first 20 Leads and 20 Contacts; narrow the search to see others.' : '')
        };
    }

    /** "Not in the inbox: …" from the loaded queue and Apex's latest-submission facts (a best guess). */
    whyNotInInbox(p) {
        const loaded = this.rows.filter((r) => r.leadId === p.id || r.contactId === p.id);
        if (loaded.some((r) => r.junkReason)) return 'marked as junk.';
        if (loaded.length) return 'its submissions were claimed and closed out more than ' + FINISHED_DAYS + ' days ago.';
        const last = toTime(p.lastSubmissionAt);
        if (last === null) return 'no form submission or instant estimate.';
        const days = Number(this.lookbackDays) || 30;
        if (Date.now() - last > days * DAY_MS) {
            return 'last submission ' + new Date(last).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) + ', older than the inbox shows.';
        }
        if (p.lastSubmissionClaimed) return 'its submissions were claimed and closed out more than ' + FINISHED_DAYS + ' days ago.';
        if (!this.prospectsLoaded) return 'may be an unclaimed prospect (open Prospects to load them).';
        return 'not in any inbox tab right now.';
    }

    handleTab(e) {
        this.tab = e.currentTarget.dataset.key;
        if (this.tab === 'prospects' && !this.prospectsLoaded && !this.prospectsLoading) this.loadProspects();
        this.resetListFilters();
        // Post Quote keys never go to selectRow: the tab picks its first reply; leaving it picks the first queue row.
        if (this.tab === 'postquote') {
            if (!this.pqListRows.some((r) => r.key === this.activeId)) this.selectFirstPq();
        } else if (!this.activeId || (isPqKey(this.activeId) && !this.pqDetailVisible)) {
            const first = this.firstQueueItem();
            if (first) this.selectRow(first.id);
            else this.activeId = null;
        }
        this.saveView();
    }

    handleRow(e) {
        const id = e.currentTarget.dataset.id;
        const row = this.visible.find((x) => x.id === id);
        if (row && row.groupKey) {
            const c = { ...this.collapsedGroups };
            delete c[row.groupKey];
            this.collapsedGroups = c;
        }
        this.selectRow(id);
    }

    handleRowOrGroup(e) {
        if (e.currentTarget.dataset.group) this.handleGroupHead(e);
        else this.handleRow(e);
    }

    /** Admins: the instant-estimate query failed (message from Salesforce), so no estimates are listed. */
    get showEstimateError() {
        return this.isAdmin && !this.loading && !!this.estimateError;
    }

    get showEstimatesOffNotice() {
        return this.isAdmin && !this.loading && !this.estimatesEnabled;
    }

    /**
     * ↻: the queue and Post Quote, then the open record's side panels (open opportunities, activity, history,
     * account, related submissions), which otherwise load only when a record is selected. The 60 s timer doesn't do this.
     */
    async handleRefresh() {
        this.loadPostQuote();
        this.loadSixSense();
        await this.load();
        const id = this.activeId;
        if (id && !isPqKey(id) && this.rows.some((r) => r.id === id)) {
            this._relatedFor = id;
            this.loadSelectionData();
        }
    }

    handleStatus(e) {
        const status = e.detail.value;
        this.draft = { ...this.draft, status };
        if (status === 'Nurture') {
            this.message = 'Nurture hands this lead to email marketing. After you save, it leaves Mine / Team.';
        } else if (status === WRONG_PROFILE) {
            this.message = 'Wrong profile: add a Lead Funnel Outcome. After you save, it leaves Mine / Team.';
        } else if (status && !ACTIVE_STATUSES.includes(status)) {
            this.message = 'Anything other than New or Working takes this off Mine / Team after you save.';
        } else {
            this.message = undefined;
        }
    }

    handleSearch(e) {
        this.searchQuery = e.target.value || '';
        // canvas #143: the search also looks in Prospects, which otherwise load only when that tab opens
        if (this.searchQuery.trim() && !this.prospectsLoaded && !this.prospectsLoading) this.loadProspects();
    }

    get hasSearch() {
        return !!(this.searchQuery || '').trim();
    }

    get searchCls() {
        return 'ldr-search' + (this.hasSearch ? ' ldr-search-on' : '');
    }

    get searchTitle() {
        return this.hasSearch
            ? 'Filtering this list by “' + this.searchQuery.trim() + '”; matches in other tabs show below the list'
            : 'Search name or email (also searches the other tabs)';
    }

    clearSearch() {
        this.searchQuery = '';
    }

    toggleHistory() {
        this.historyExpanded = !this.historyExpanded;
    }

    toggleActivity() {
        this.activityExpanded = !this.activityExpanded;
    }

    openPerson(e) {
        const id = e.currentTarget.dataset.id;
        if (this.rows.some((x) => x.id === id)) {
            // In the queue: jump to it (from there the LDR can claim it).
            const row = this.rows.find((x) => x.id === id);
            if (!this.inTab(row, this.tab)) {
                this.tab = row.claimedById ? (row.claimedById === this.meId ? 'mine' : 'team') : 'unclaimed';
            }
            this.selectRow(id);
        } else {
            this.openRecord(id); // Form Submission or Instant Estimate: the Id says which
        }
    }

    openAccountOpps() {
        const a = this.active;
        if (!a || !a.matchedAccountId) return;
        this[NavigationMixin.Navigate]({
            type: 'standard__recordRelationshipPage',
            attributes: {
                recordId: a.matchedAccountId,
                objectApiName: 'Account',
                relationshipApiName: 'Opportunities',
                actionName: 'view'
            }
        });
    }

    handlePreField(e) {
        if (!e.detail) return; // v5.7b: a plain change event bubbling up from inside the field, not the field's own
        const field = e.target.fieldName;
        let value = e.detail.value;
        if (Array.isArray(value)) value = value.length ? value[0] : ''; // lookup fields return an array of Ids
        this.draft = { ...this.draft, pre: { ...this.draft.pre, [field]: value } };
        this.clearAutoFilled({ [field]: value });
    }

    /**
     * v5.7: a field Populate Project filled loses its highlight once its value changes (an LDR edit, or a dependent
     * picklist cleared by its controlling field). A change event that repeats the filled value keeps it.
     */
    clearAutoFilled(changes) {
        const keys = Object.keys(changes).filter(
            (f) => Object.prototype.hasOwnProperty.call(this.autoFilled, f) && String(changes[f] || '') !== String(this.autoFilled[f] || '')
        );
        if (!keys.length) return;
        const next = { ...this.autoFilled };
        keys.forEach((f) => delete next[f]);
        this.autoFilled = next;
    }

    /** v5.7: Project Details classes; Populate Project's fields carry ldr-autofilled until changed. */
    get pdCls() {
        const on = (f, base) => (base ? base + ' ' : '') + (Object.prototype.hasOwnProperty.call(this.autoFilled, f) ? 'ldr-autofilled' : '');
        return {
            name: on('Project_Name__c', 'ldr-project-name'),
            type: on('Type_of_record__c'),
            industry: on('Project_Application_Industry__c'),
            application: on('Project_Application__c')
        };
    }

    /**
     * v5.7b: the address parts Populate Project filled in, listed in a highlighted line under the address. The inbox
     * can't colour the inputs inside lightning-input-address (Salesforce's component; its insides can't be styled from
     * outside), and highlighting the whole box also marked Address Search. Each part drops off when it's changed.
     */
    get autoFilledAddress() {
        const label = {
            Project_Site_Street__c: 'Street',
            Project_Site_City__c: 'City',
            Project_Site_State__c: 'State',
            Project_Site_Zip_Code__c: 'Zip',
            Project_Site_Country__c: 'Country'
        };
        return Object.keys(label)
            .filter((f) => Object.prototype.hasOwnProperty.call(this.autoFilled, f))
            .map((f) => ({ key: f, label: label[f] }));
    }

    get hasAutoFilledAddress() {
        return this.autoFilledAddress.length > 0;
    }

    /** #160: Project Name as a one-line box: the draft value, else what the Lead form loaded. */
    get projectNameValue() {
        const p = this.draft.pre || {};
        return Object.prototype.hasOwnProperty.call(p, 'Project_Name__c') ? p.Project_Name__c || '' : this.preBase.Project_Name__c || '';
    }

    handleProjectName(e) {
        this.draft = { ...this.draft, pre: { ...this.draft.pre, Project_Name__c: e.detail.value || '' } };
        this.clearAutoFilled({ Project_Name__c: e.detail.value || '' });
    }

    /** Project Coordinator dropdown (coordinatorOptions). */
    handleCoordinatorPick(e) {
        const id = e.detail ? e.detail.value || '' : '';
        this.draft = { ...this.draft, pre: { ...this.draft.pre, Project_Coordinator__c: id } };
    }

    get sixSenseOptions() {
        return [{ label: '--None--', value: '' }, ...this.sixSenseValues.map((v) => ({ label: v, value: v }))];
    }

    handleSixSense(e) {
        this.sixSenseDraft = { id: this.activeId, value: e.detail.value || '' };
    }

    cancelSixSense() {
        this.sixSenseDraft = null;
    }

    async saveSixSense() {
        const a = this.active;
        if (!a || !this.sixSenseDraft) return;
        const value = this.sixSenseDraft.value;
        await this.run(async () => {
            await saveSixSenseApex({ submissionId: a.id, value });
            this.sixSenseDraft = null;
            this.message = '6Sense Option saved: ' + (value || 'blank') + '.';
        });
    }

    /** Nearest showroom to the Lead/Contact geocode (null when none within range). */
    nearestFor(r) {
        const s = r.raw;
        const lat = r.isContactLinked ? (s.Contact__r || {}).MailingLatitude : (s.Lead__r || {}).Latitude;
        const lon = r.isContactLinked ? (s.Contact__r || {}).MailingLongitude : (s.Lead__r || {}).Longitude;
        return nearestShowroom(lat, lon);
    }

    // ------------------------------------------------------------ FETR (rep hand-off email), Contact rows

    /**
     * FETR rows, same rules as the team's FETR template: Type from the Contact's Lead Type / Account (Homeowner when
     * the Account is the person), Account blank for Homeowners, Inquiry Type "Consultation/Quote", Plans Attached/None,
     * KBMax / Instant Estimator from Related submissions, N/A when empty. Links are absolute (pasted into Outlook).
     */
    fetrRows(r) {
        const s = r.raw;
        const c = s.Contact__r || {};
        const base = window.location.origin + '/lightning/r/';
        const acct = (c.Account && c.Account.Name) || r.company || '';
        // #160: Contact Information from the Contact record, falling back to the submission
        const cName = c.Name || r.name;
        const cEmail = c.Email || r.email;
        const cPhone = c.Phone || r.phone || '';
        const rt = (r.recordType || r.customerType || '').toLowerCase();
        let type = 'Contractor';
        if (rt.includes('home') || (acct && acct.trim().toLowerCase() === (cName || '').trim().toLowerCase())) type = 'Homeowner';
        else if (rt.includes('architect') || /architect|design studio|\baia\b/i.test(acct)) type = 'Architect';
        const digits = cPhone.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
        const phone = digits.length === 10 ? '(' + digits.slice(0, 3) + ') ' + digits.slice(3, 6) + '-' + digits.slice(6) : cPhone;
        // canvas #120: the project picked for this submission (was always the first open opportunity)
        const opp = this.fetrPick(r).opp || {};
        const projName = opp.projectName || (s.Project_Name__c || '').trim();
        const kb = this.related.filter((x) => x.source === 'kbmax');
        const est = this.related.filter((x) => x.source === 'estimate');
        const inq = ['Quote', 'Consultation'].includes(s.Inquiry_Type__c) ? 'Consultation/Quote' : s.Inquiry_Type__c || 'Consultation/Quote';
        // canvas aabc (#96D): Split Territory = the first open opportunity's owner and its Project's owner differ.
        const split = opp.projectOwner && opp.owner && opp.projectOwner !== opp.owner ? 'Yes - Copying ' + opp.projectOwner : 'No';
        let n = 0;
        const H = (k, dark) => ({ key: 'h' + n++, isHeader: true, k, dark: !!dark, bg: dark ? '#4A6D22' : '#74A63A', fg: dark ? '#fff' : '#000', cls: dark ? 'ldr-fetr-h ldr-fetr-h-dark' : 'ldr-fetr-h' });
        // canvas #122: these two values start on the line below the label (card, copied HTML and text)
        const BELOW = { qcc: true, home: true };
        // v6f8: every value can be edited before copying (fetrEdits, by row id; never saved). Multi-line values get a
        // textarea, the rest a one-line input. A linked value keeps its link with the edited text (an edited email
        // becomes the mailto); an emptied one has no link.
        const edits = this.fetrEdits[r.id] || {};
        const R = (id, k, v, href) => {
            const edited = Object.prototype.hasOwnProperty.call(edits, id);
            const val = edited ? edits[id] : v || '';
            const link = href && href.startsWith('mailto:') ? (val.trim() ? 'mailto:' + val.trim() : '') : href || '';
            const hasHref = !!(link && val.trim());
            const multi = !!BELOW[id] || id === 'estimator';
            return {
                key: 'r' + n++,
                id,
                isHeader: false,
                k,
                v: val,
                href: link,
                hasHref,
                below: !!BELOW[id],
                multi,
                rowCls: 'ldr-fetr-row ldr-fetr-edit' + (BELOW[id] ? ' ldr-fetr-edit-below' : ''),
                inCls: (multi ? 'ldr-fetr-in ldr-fetr-ta' : 'ldr-fetr-in') + (hasHref ? ' ldr-fetr-in-link' : ''),
                lines: Math.max(1, val.split('\n').length)
            };
        };
        const attachments = parseAttachments(s.Attachments__c);
        return [
            H('NanaWall – FETR', true),
            H('Contact Information'),
            R('contact', 'Contact', cName, base + 'Contact/' + r.contactId + '/view'),
            R('email', 'Email', cEmail, cEmail ? 'mailto:' + cEmail : ''),
            R('phone', 'Phone', '# ' + phone),
            // canvas aabc (#96D): Contact.LeadType__c, else the old rule. (#160 says Record Type; production Contacts
            // have no record types, all "Master", so the Lead Type stays.)
            R('ctype', 'Type', r.recordType || type),
            R('account', 'Account', type === 'Homeowner' ? '' : acct, type === 'Homeowner' || !c.AccountId ? '' : base + 'Account/' + c.AccountId + '/view'),
            H('Project'),
            R('project', 'Name', projName || '[Project]', opp.projectId ? base + 'Project__c/' + opp.projectId + '/view' : ''),
            R('split', 'Split Territory', split),
            H('Inquiry Details'),
            // canvas aabc (#96D): the form's Inquiry Type as-is (Consultation, Quote, Contact Us…)
            R('itype', 'Type', s.Inquiry_Type__c || inq),
            R('qcc', 'Questions/Comments/Concerns', ((s.Questions_or_Comments__c || s.Comments__c || '').trim() || '[Insert inquiry text here]') + fetrProjectLines(s)),
            H('Additional Information'),
            R('plans', 'Plans/Pictures', attachments.length ? 'Attached' : 'None'),
            (() => {
                // canvas 9fed: Windfall values (the converted Lead's until the Contact has its own).
                const w = this.windfallSource(r);
                const fmt = (v) => (v ? '$' + Math.round(Number(v)).toLocaleString('en-US') : '');
                const calc = wfDateLabel(w.wf_net_worth_calculation_date__c);
                // Canvas: every Windfall line, same as the Windfall card.
                const lines = [
                    ['B2C Lead Grade', w.Windfall_Lead_Grade__c],
                    ['Estimated Property Value', fmt(w.wf_windfall_avm__c)],
                    ['Net Worth', fmt(w.wf_net_worth__c)],
                    ['High Confidence Net Worth', fmt(w.wf_high_confidence_net_worth__c)],
                    ['Low Confidence Net Worth', fmt(w.wf_low_confidence_net_worth__c)],
                    ['Net Worth Last Calculated', calc],
                    ['Additional Windfall Property Value 1', fmt(w.wf_windfall_property_value_1__c)],
                    ['Additional Windfall Property Value 2', fmt(w.wf_windfall_property_value_2__c)],
                    ['Additional Windfall Property Value 3', fmt(w.wf_windfall_property_value_3__c)]
                ].filter((x) => x[1]);
                const useful = lines.length > 1 || (lines.length === 1 && !/^5 U/.test(lines[0][1]));
                return R(
                    'home',
                    'Home/Zip Code Value',
                    // canvas #121: no "(Windfall from the converted Lead)" line
                    useful ? lines.map((x) => x[0] + ': ' + x[1]).join('\n') : 'N/A'
                );
            })(),
            kb.length
                ? R('kbmax', 'KBMax Configurator Link', kb[0].name + (kb.length > 1 ? ' (+' + (kb.length - 1) + ' more)' : ''), base + 'KBMax_Web_Quote__c/' + kb[0].recordId + '/view')
                : R('kbmax', 'KBMax Configurator Link', 'N/A'),
            R('estimator', 'Instant Estimator', est.length ? est.map((x) => x.name + ' - ' + x.summary + ' - ' + (x.amount || '')).join('\n') : 'N/A')
        ];
    }

    /** v6f8: a FETR value typed over (kept per submission while the inbox is open; Copy FETR uses it). */
    handleFetrEdit(e) {
        const sid = this.activeId;
        const id = e.target.dataset.id;
        if (!sid || !id) return;
        this.fetrEdits = { ...this.fetrEdits, [sid]: { ...(this.fetrEdits[sid] || {}), [id]: e.target.value } };
    }

    /** v6f8: back to the Salesforce values. */
    resetFetr() {
        const sid = this.activeId;
        if (!sid) return;
        const next = { ...this.fetrEdits };
        delete next[sid];
        this.fetrEdits = next;
    }

    /**
     * canvas #120: which of the Contact's open projects the FETR uses for this submission. One entry per project
     * (Open opportunities, newest first). Default, first that applies: the LDR's pick; the submission's Project name
     * found in a project / opportunity name; the project zip's city found in exactly one name; the newest opportunity.
     */
    fetrPick(r) {
        const out = { list: [], opp: null, how: '', city: '' };
        if (!r || !r.isContactLinked) return out;
        const seen = {};
        this.contactOpps.forEach((o) => {
            const k = o.projectId || o.projectName || o.recordId;
            if (k && !seen[k]) {
                seen[k] = true;
                out.list.push({ ...o, pickKey: k });
            }
        });
        if (!out.list.length) return out;
        const norm = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
        const named = (o) => norm((o.projectName || '') + ' ' + (o.name || ''));
        const picked = this.fetrProjectPick[r.id];
        let opp = picked ? out.list.find((o) => o.pickKey === picked) || null : null;
        let how = opp ? 'picked' : '';
        const pn = norm(r.raw.Project_Name__c);
        if (!opp && pn.length >= 4) {
            opp = out.list.find((o) => { const p = norm(o.projectName); return named(o).includes(pn) || (p.length >= 4 && pn.includes(p)); }) || null;
            if (opp) how = 'name';
        }
        if (!opp) {
            const city = this.fetrCityFor(r);
            const cn = norm(city);
            const hits = cn ? out.list.filter((o) => (' ' + named(o) + ' ').includes(' ' + cn + ' ')) : [];
            if (hits.length === 1) {
                opp = hits[0];
                how = 'city';
                out.city = city;
            }
        }
        if (!opp) {
            opp = out.list.slice().sort((x, y) => (toTime(y.createdDate) || 0) - (toTime(x.createdDate) || 0))[0];
            how = out.list.length > 1 ? 'newest' : 'only';
        }
        out.opp = opp;
        out.how = how;
        return out;
    }

    /**
     * City for the submission's project zip (homeowners: their zip; others: Project Postal Code). The canvas looks the
     * zip up in a simulated table; the inbox has no zip-to-city source, so it uses the form's or the Contact's city when
     * that zip matches, else the form / Contact city (the canvas's own fallback).
     */
    fetrCityFor(r) {
        const s = r.raw;
        const c = s.Contact__r || {};
        const zip5 = (x) => String(x || '').trim().slice(0, 5);
        const z = zip5((r.customerType === 'Homeowner' ? s.Zip_or_Postal_Code__c : s.Project_Postal_Code__c) || s.Zip_or_Postal_Code__c);
        if (z && zip5(s.Zip_or_Postal_Code__c) === z && s.City__c) return s.City__c;
        if (z && zip5(c.MailingPostalCode) === z && c.MailingCity) return c.MailingCity;
        return s.City__c || c.MailingCity || '';
    }

    /** View model for the FETR project picklist (shown with 2+ projects) and its "how it was matched" note. */
    fetrProjectView(r) {
        const p = r.isContactLinked ? this.fetrPick(r) : { list: [] };
        const notes = {
            picked: 'Project picked for this submission.',
            name: 'Matched to this submission’s project name. Change it if that’s wrong.',
            city: 'Matched by the project’s city (' + p.city + '). Change it if that’s wrong.',
            newest: 'Couldn’t match this submission to a project: showing the newest opportunity. Pick the right project.'
        };
        const val = p.opp ? p.opp.pickKey : '';
        return {
            hasFetrProjects: p.list.length > 1,
            fetrProjects: p.list.map((o) => ({ value: o.pickKey, label: o.projectName || o.name, selected: o.pickKey === val })),
            fetrProjectNote: notes[p.how] || '',
            fetrProjectNoteCls: 'ldr-fetr-note' + (p.how === 'newest' ? ' ldr-fetr-note-warn' : '')
        };
    }

    handleFetrProject(e) {
        const a = this.active;
        if (!a) return;
        this.fetrProjectPick = { ...this.fetrProjectPick, [a.id]: e.target.value };
        // v6f8: the new project's Name and Split Territory replace any typed-over ones
        const ed = this.fetrEdits[a.id];
        if (ed && ('project' in ed || 'split' in ed)) {
            const rest = { ...ed };
            delete rest.project;
            delete rest.split;
            this.fetrEdits = { ...this.fetrEdits, [a.id]: rest };
        }
    }

    copyFetr() {
        const a = this.active;
        if (!a) return;
        const rows = a.fetrRows;
        const text = rows.map((x) => (x.isHeader ? '\n' + x.k : x.k + ':' + (x.below ? '\n' : ' ') + x.v)).join('\n').trim();
        this.copyRich(fetrHtml(rows), text).then((ok) => {
            this.message = ok ? 'FETR copied with links. Paste it into the email to the rep.' : 'Couldn’t copy automatically here; select the FETR box and copy it.';
        });
    }

    // ------------------------------------------------------------ rich copy (draft email, FETR)

    /**
     * Copies HTML + plain text. Tries the async Clipboard API; if Lightning blocks it, selects a hidden copy of the
     * HTML inside this component and uses execCommand('copy'), which keeps the formatting. Resolves true/false.
     */
    copyRich(html, text) {
        const fallback = () => {
            let ok = false;
            try {
                const host = this.template.querySelector('.ldr-copy-host');
                // eslint-disable-next-line @lwc/lwc/no-inner-html
                host.innerHTML = html;
                const range = document.createRange();
                range.selectNodeContents(host);
                const sel = window.getSelection();
                sel.removeAllRanges();
                sel.addRange(range);
                ok = document.execCommand('copy');
                sel.removeAllRanges();
                // eslint-disable-next-line @lwc/lwc/no-inner-html
                host.innerHTML = '';
            } catch {
                ok = false;
            }
            return ok;
        };
        try {
            if (navigator.clipboard && navigator.clipboard.write && window.ClipboardItem) {
                const item = new window.ClipboardItem({
                    'text/html': new Blob([html], { type: 'text/html' }),
                    'text/plain': new Blob([text], { type: 'text/plain' })
                });
                return navigator.clipboard.write([item]).then(() => true, () => fallback());
            }
        } catch {
            // fall through
        }
        return Promise.resolve(fallback());
    }

    /** "Copy details & open mail app": copy, then the link's own click opens the mail app (To, Bcc, Subject). */
    copyEmailAndOpen() {
        this.copyEmailDetails();
    }

    copyEmailOnly() {
        this.copyEmailDetails();
    }

    copyEmailDetails() {
        const a = this.active;
        if (!a) return;
        this.copyRich(a.emailHtml, a.emailText).then((ok) => {
            this.emailCopied = ok ? 'ok' : 'failed';
        });
    }

    get emailCopiedOk() {
        return this.emailCopied === 'ok';
    }

    get emailCopyFailed() {
        return this.emailCopied === 'failed';
    }

    openFactLink(e) {
        this.openRecord(e.currentTarget.dataset.id, e.currentTarget.dataset.object || 'Account');
    }

    get relatedShown() {
        return this.relatedExpanded ? this.related : this.related.slice(0, RELATED_PAGE);
    }

    get hasMoreRelated() {
        return this.related.length > RELATED_PAGE;
    }

    get relatedShownLabel() {
        return 'Showing ' + this.relatedShown.length + ' of ' + this.related.length;
    }

    get relatedToggleLabel() {
        return this.relatedExpanded ? 'Show Less' : 'Load More (' + (this.related.length - RELATED_PAGE) + ')';
    }

    toggleRelated() {
        this.relatedExpanded = !this.relatedExpanded;
    }

    handleFunnelTs(e) {
        this.draft = { ...this.draft, pre: { ...this.draft.pre, Lead_Funnel_Time_Stamp__c: e.target.value || '' } };
    }

    /**
     * Project Coordinator choices (Aqil, 2026-10-30): you first, then the coordinators (Apex COORDINATOR_NAMES) and
     * whoever is on the record now, A-Z, then a blank option that clears the field. Values are User Ids, so Save writes
     * the Project_Coordinator__c lookup.
     */
    coordinatorOptions(currentId, currentName) {
        const others = new Map(Object.entries(this.coordinators || {}));
        if (currentId && currentName) others.set(currentId, currentName);
        others.delete(this.meId);
        return [
            { label: this.meName, value: this.meId },
            ...Array.from(others, ([value, label]) => ({ label, value })).sort((a, b) => a.label.localeCompare(b.label)),
            { label: ' ', value: '' } // blank (a space, so the row keeps its height)
        ];
    }

    /** Project Details form loaded: remember the saved values, so "Unsaved changes" compares against them. */
    handleProjectFormLoad(e) {
        const recs = (e.detail && e.detail.records) || {};
        const rec = recs[Object.keys(recs)[0]];
        if (!rec || !rec.fields) return;
        const base = {};
        PROJECT_DETAIL_FIELDS.forEach((f) => {
            if (rec.fields[f]) base[f] = rec.fields[f].value;
        });
        this.preBase = base;
    }

    get conflictVisible() {
        return !!this.conflictMsg && !this.dismissedAlerts[this.activeId + ':conflict'];
    }

    /** × on a banner: hides it for this submission until the LDR switches submission or tab. Nothing is saved. */
    dismissAlert(e) {
        const key = e.currentTarget.dataset.key;
        if (!DISMISSABLE.includes(key) || !this.activeId) return;
        this.dismissedAlerts = { ...this.dismissedAlerts, [this.activeId + ':' + key]: true };
    }

    /**
     * Unsaved changes = the draft differs from what was last saved. Computed (no stored flag), so nothing that
     * fires onchange while the forms rebuild can leave "Unsaved changes" showing after Cancel.
     */
    get ldrDirty() {
        const r = this.rows.find((x) => x.id === this.activeId);
        if (!r) return false;
        const norm = (v) => (v === null || v === undefined ? '' : String(v));
        const d = this.draft;
        const b = this.draftBase;
        if (norm(d.status) !== norm(b.status) || norm(d.outcome) !== norm(b.outcome)) return true;
        const rowBase = { Project_Coordinator__c: r.coordinatorId, Lead_Funnel_Time_Stamp__c: r.funnelTs };
        return Object.keys(d.pre || {}).some((k) => {
            let base;
            if (Object.prototype.hasOwnProperty.call(b.pre, k)) base = b.pre[k];
            else if (Object.prototype.hasOwnProperty.call(rowBase, k)) base = rowBase[k];
            else base = this.preBase[k];
            return norm(d.pre[k]) !== norm(base);
        });
    }

    get ldrClean() {
        return !this.ldrDirty || this.busy;
    }

    get handoffDisabled() {
        return this.busy || this.ldrDirty;
    }

    get handoffTitle() {
        if (this.ldrDirty) return 'Save your changes first: the Convert Lead flow reads what is saved on the Lead';
        const a = this.active;
        const first = a ? a.ownerFirst : 'rep';
        return a && a.isContactLinked
            ? 'Set Lead Funnel Status to Qualified and the timestamp to today, then create a new Project, or find an existing one, and attach this Contact to a new Opportunity on it'
            : 'Convert the Lead and hand off to ' + first;
    }

    /** Cancel: discards every unsaved LDR-field edit (status, outcome, coordinator, Project Details). */
    cancelLdrEdits() {
        // Rebuild the forms (new key) rather than calling reset() on the inputs.
        this.formNonce += 1;
        this.preBase = {};
        this.resetDraft();
        this.autoFilled = {};
        this.message = 'Changes since the last save were discarded.';
    }


    /** Current value of a Lead field in the pre-conversion form (draft edit, else what Salesforce loaded). */
    preValue(field) {
        if (Object.prototype.hasOwnProperty.call(this.draft.pre, field)) return this.draft.pre[field];
        const el = this.template.querySelector('lightning-input-field[data-field="' + field + '"]');
        return el ? el.value : null;
    }

    /**
     * Homeowner leads: Project Name = "<Last name> Residence - City, ST" plus Residential /
     * Single Family - Remodel / Living Room. City/State come from the Project Site fields, else the
     * Lead's own address. (The prototype's zip-code lookup isn't built: it needs a postal-code service.)
     */
    /**
     * Populate Project (all customer types; Lead rows only).
     * - Homeowner: Project Name "<Last> Residence - City, ST" + Residential / Living Room, Industry Single Family - New
     *   or Remodel from the submission's construction classification (#124; blank -> Remodel),
     *   plus the Project Site address from the Lead (street, city, state, zip, country), else the form's
     *   Project Postal Code / Zip / Country. Only values that were found are set.
     * - Everyone else, from the form: Project Name; Project Type from Application (only Residential/Other ticked
     *   → Residential, anything else → Commercial); for Commercial, the first Application that matches a
     *   Commercial industry ("Restaurants" → Restaurant, "Educational" → Education); Project Site Country from
     *   the Lead; Project Site Zip from the form's Project Postal Code.
     * Nothing is saved until Save.
     */
    populateProject() {
        const a = this.active;
        if (!a || !a.isMine || a.isContactLinked || a.isUnlinked) return;
        const s = a.raw;
        const lead = s.Lead__r || {};
        const values = {};
        if (a.customerType === 'Homeowner') {
            const last = lastNameOf(s, a.name) || '[Last Name]';
            const city = this.preValue('Project_Site_City__c') || lead.City || '';
            const state = stateForPicklist(this.preValue('Project_Site_State__c') || lead.State);
            const where = [city, STATE_ABBREV[state] || state].filter(Boolean).join(', ');
            values.Project_Name__c = last + ' Residence' + (where ? ' - ' + where : '');
            // canvas #124: Industry from the submission's construction classification (forms:
            // Project_Construction_Classification__c; instant estimates: Project_Classification__c). Blank -> Remodel.
            const cls = String(s.Project_Construction_Classification__c || (s.estimate && s.estimate.classification) || '').trim();
            const industry = /^new/i.test(cls) ? 'Single Family - New' : 'Single Family - Remodel';
            Object.assign(values, HOMEOWNER_PROJECT_DEFAULTS, { Project_Application_Industry__c: industry });
            const addr = {
                Project_Site_Country__c: lead.Country || s.Country__c || '',
                Project_Site_Street__c: lead.Street || '',
                Project_Site_City__c: lead.City || '',
                Project_Site_State__c: stateForPicklist(lead.State),
                Project_Site_Zip_Code__c: s.Project_Postal_Code__c || lead.PostalCode || s.Zip_or_Postal_Code__c || ''
            };
            Object.keys(addr).forEach((k) => {
                if (addr[k]) values[k] = addr[k];
            });
        } else {
            const formName = (s.Project_Name__c || '').trim();
            const apps = (s.Application__c || '').split(',').map((x) => x.trim()).filter(Boolean);
            if (formName) values.Project_Name__c = formName;
            let type = '';
            if (apps.length) {
                const residentialOnly = apps.includes('Residential') && apps.every((x) => x === 'Residential' || x === 'Other');
                type = residentialOnly ? 'Residential' : 'Commercial';
                values.Type_of_record__c = type;
            }
            if (type === 'Commercial') {
                const norm = (x) => x.toLowerCase().replace(/[^a-z]/g, '');
                const match = (app) =>
                    COMMERCIAL_INDUSTRIES.find((ind) => {
                        const x = norm(app);
                        const y = norm(ind);
                        return x === y || x === y + 's' || x === y + 'al' || y === x + 's';
                    });
                const industry = apps.filter((x) => x !== 'Other' && x !== 'Residential').map(match).find(Boolean);
                if (industry) values.Project_Application_Industry__c = industry;
            }
            if (lead.Country) values.Project_Site_Country__c = lead.Country;
            if (s.Project_Postal_Code__c) values.Project_Site_Zip_Code__c = s.Project_Postal_Code__c;
        }
        // Controlling fields first so dependent picklists accept the next value.
        [
            'Project_Name__c', 'Type_of_record__c', 'Project_Application_Industry__c', 'Project_Application__c',
            'Project_Site_Country__c', 'Project_Site_State__c', 'Project_Site_Street__c', 'Project_Site_City__c',
            'Project_Site_Zip_Code__c'
        ].forEach((f) => {
            if (!(f in values)) return;
            const el = this.template.querySelector('lightning-input-field[data-field="' + f + '"]');
            if (el) el.value = values[f];
        });
        this.draft = { ...this.draft, pre: { ...this.draft.pre, ...values } };
        // v5.7: highlight what was filled in (like a browser's autofill) until it's changed, saved or cancelled
        this.autoFilled = { ...this.autoFilled, ...values };
        this.projectDetailsOpen = true;
        // v6g5 (Aqil): no "Populated Project: …" summary line; the filled-in fields are highlighted (and the address
        // parts listed under the address) until they're changed, saved or cancelled
    }

    startEmailPreview() {
        this.emailCopied = null;
        this.emailTemplate = '';
        this.emailMessage = null; // #152 H: reopening starts fresh
        this.emailSubjectEdit = null;
        this.showEmailPreview = true;
    }

    /** v6g3: the Subject typed over (the mail-app links use it; reopening starts fresh). */
    handleEmailSubject(e) {
        this.emailSubjectEdit = e.target.value;
    }

    /**
     * Template buttons under the Draft email title: click toggles that template; another one switches (#96B). The
     * template replaces the message, edits included (#152 H).
     */
    pickEmailTemplate(e) {
        const kind = e.currentTarget.dataset.kind || '';
        this.emailTemplate = this.emailTemplate === kind ? '' : kind;
        this.emailMessage = null;
        this.emailCopied = null;
    }

    /** The editable message (#152 H / #155 B). */
    handleEmailMessage(e) {
        this.emailMessage = e.target.value;
        this.emailCopied = null;
    }

    /** Undo Edits: back to the chosen template's text (or empty). */
    undoEmailEdits() {
        this.emailMessage = null;
        this.emailCopied = null;
    }

    closeEmailPreview() {
        this.showEmailPreview = false;
        this.emailMessage = null;
        this.emailSubjectEdit = null;
    }

    handleOutcome(e) {
        this.draft = { ...this.draft, outcome: e.detail.value };
    }

    dismissConflict() {
        this.conflictMsg = undefined;
    }

    startLogCall() {
        this.loggingCall = true;
        this.callOutcome = '';
        this.callNotes = '';
    }

    cancelLogCall() {
        this.loggingCall = false;
        this.callOutcome = '';
        this.callNotes = '';
    }

    /**
     * Opens a record in Salesforce in the same browser tab.
     * - Console app (LDR Console): opens (or focuses) the record as a workspace tab next to the inbox.
     * - Standard app: navigates to the record page.
     */
    async openRecord(recordId, objectApiName) {
        if (!recordId) return;
        if (this.isConsole && this.isConsole.data) {
            try {
                await openTab({ recordId, focus: true });
                return;
            } catch {
                // fall through to a browser tab
            }
        }
        // Standard app: open the record in this browser tab (Salesforce tab), not a new browser tab.
        const pageRef = {
            type: 'standard__recordPage',
            attributes: { recordId, actionName: 'view' }
        };
        if (objectApiName) pageRef.attributes.objectApiName = objectApiName;
        this[NavigationMixin.Navigate](pageRef);
    }

    openLead() {
        const a = this.active;
        if (a) this.openRecord(a.recordId, a.isContactLinked ? 'Contact' : 'Lead');
    }

    /** v5.6: the Project Details button on the LDR Fields title line (Lead rows). */
    get showProjectDetailsBtn() {
        const a = this.active;
        return !!a && a.hasLinkedRecord && a.showProjectDetails;
    }

    openProjectDetails() {
        this.projectDetailsOpen = true;
    }

    /** The popup stays rendered (the form keeps its loaded values); closed = hidden. */
    get projectPopupCls() {
        return this.projectDetailsOpen ? 'ldr-overlay' : 'ldr-overlay ldr-hidden';
    }

    /** Populate Project sits on the Project Details popup's title line. */
    get showPopulateButton() {
        return !!this.active && this.active.showPopulateProject;
    }

    /** Who gets Save: the claimer, or an admin editing without claiming (same as the LDR Fields Save). */
    get canSaveLdrFields() {
        const a = this.active;
        return !!a && (a.isMine || a.adminEdit);
    }

    /** Quote Requested / Reference Opportunity: the draft ('true' / 'false'), else as saved on the Lead. */
    preChecked(field) {
        const p = this.draft.pre || {};
        const v = Object.prototype.hasOwnProperty.call(p, field) ? p[field] : this.preBase[field];
        return v === true || v === 'true';
    }

    get quoteRequestedChecked() {
        return this.preChecked('Quote_Request__c');
    }

    get referenceOppChecked() {
        return this.preChecked('Reference_Opportunity__c');
    }

    handlePreCheckbox(e) {
        const field = e.target.dataset.field;
        this.draft = { ...this.draft, pre: { ...this.draft.pre, [field]: e.target.checked ? 'true' : 'false' } };
    }

    /** Cancel in the popup: drops the Project Details edits only (status, outcome and coordinator edits stay). */
    cancelProjectDetails() {
        const base = this.draftBase.pre || {};
        const pre = { ...this.draft.pre };
        PROJECT_DETAIL_FIELDS.forEach((f) => {
            if (Object.prototype.hasOwnProperty.call(base, f)) pre[f] = base[f];
            else delete pre[f];
        });
        this.draft = { ...this.draft, pre };
        // Rebuild the forms (new key) so the inputs show the saved values again.
        this.formNonce += 1;
        this.preBase = {};
        this.autoFilled = {};
        this.projectDetailsOpen = false;
    }

    /** Save in the popup: the LDR Fields save; the popup closes once it worked (an error keeps it open). */
    async saveProjectDetails() {
        if (await this.save()) this.projectDetailsOpen = false;
    }

    openSubmission() {
        const a = this.active;
        if (!a) return;
        if (a.isConfigurator) {
            // canvas dd24: "Open 3D Configurator Quote" opens the latest KBMax_Web_Quote__c record (the row's Id). The saved
            // project stays in the Files card.
            this.openRecord(a.id, 'KBMax_Web_Quote__c');
        } else this.openRecord(a.id, a.isEstimate ? 'Website_Instant_Estimate__c' : 'Form_Submission__c');
    }

    openContactAccount() {
        const a = this.active;
        if (a && a.contactAccountId) this.openRecord(a.contactAccountId, 'Account');
    }

    openMatchedAccount() {
        const a = this.active;
        if (a) this.openRecord(a.matchedAccountId, 'Account');
    }

    /** Image attachments of the selected submission, in order (what the lightbox pages through). */
    get lightboxImages() {
        const a = this.active;
        if (a && a.isConfigurator) {
            const pd = this.prospectDetail;
            return (pd.previews || []).map((x) => ({
                url: x.url,
                label: x.label,
                placeholder: !x.hasImage,
                sub: x.hasImage ? 'Main render' : x.sub + ' · no preview link in Salesforce yet'
            }));
        }
        return a ? a.attachments.filter((x) => x.isImage) : [];
    }

    get lightboxIsPlaceholder() {
        const c = this.currentLightboxImage;
        return !!(c && c.placeholder);
    }

    get lightboxIsImage() {
        return !this.lightboxIsPlaceholder;
    }

    get lightboxSub() {
        const c = this.currentLightboxImage;
        return c && c.sub ? c.sub : '';
    }

    openLightbox(e) {
        const url = e.currentTarget.dataset.url;
        const idx = this.lightboxImages.findIndex((x) => x.url === url);
        this.lightboxIndex = idx >= 0 ? idx : null;
    }

    closeLightbox() {
        this.lightboxIndex = null;
    }

    stopLightboxClick(e) {
        e.stopPropagation();
    }

    prevLightbox(e) {
        e.stopPropagation();
        const n = this.lightboxImages.length;
        if (n) this.lightboxIndex = (this.lightboxIndex - 1 + n) % n;
    }

    nextLightbox(e) {
        e.stopPropagation();
        const n = this.lightboxImages.length;
        if (n) this.lightboxIndex = (this.lightboxIndex + 1) % n;
    }

    handleLightboxKey(e) {
        if (e.key === 'ArrowLeft') this.prevLightbox(e);
        else if (e.key === 'ArrowRight') this.nextLightbox(e);
        else if (e.key === 'Escape') this.closeLightbox();
    }

    get currentLightboxImage() {
        const imgs = this.lightboxImages;
        return this.lightboxIndex !== null && this.lightboxIndex < imgs.length ? imgs[this.lightboxIndex] : null;
    }

    get hasLightbox() {
        return !!this.currentLightboxImage;
    }

    get lightboxUrl() {
        return this.currentLightboxImage ? this.currentLightboxImage.url : '';
    }

    get lightboxLabel() {
        return this.currentLightboxImage ? this.currentLightboxImage.label : '';
    }

    get hasMultipleLightboxImages() {
        return this.lightboxImages.length > 1;
    }

    get lightboxPosition() {
        return this.lightboxIndex + 1 + ' of ' + this.lightboxImages.length;
    }

    toggleQuickEdit() {
        this.quickEditOpen = !this.quickEditOpen;
        this.resetQuickEdit();
    }

    cancelQuickEdit() {
        this.quickEditOpen = false;
        this.resetQuickEdit();
    }

    resetQuickEdit() {
        this.qeAddr = {};
        this.qeError = '';
        this.qeSaving = false;
        this._qeLoaded = false;
    }

    /** Address parts -> the record's address fields (State & Country Picklists: the …Code fields). */
    qeFieldMap() {
        return this.active && this.active.isLeadLinked
            ? { street: 'Street', city: 'City', province: 'StateCode', country: 'CountryCode', postalCode: 'PostalCode' }
            : { street: 'MailingStreet', city: 'MailingCity', province: 'MailingStateCode', country: 'MailingCountryCode', postalCode: 'MailingPostalCode' };
    }

    get qeStateOptions() {
        return this.stateValuesFor(this.qeAddr.country);
    }

    /** The saved address, from the form's hidden address fields, becomes the draft (once per open: LDS reloads keep edits). */
    handleQuickEditLoad(e) {
        if (this._qeLoaded) return;
        const recs = (e.detail && e.detail.records) || {};
        const rec = recs[Object.keys(recs)[0]];
        if (!rec || !rec.fields) return;
        const m = this.qeFieldMap();
        const a = {};
        Object.keys(m).forEach((k) => {
            a[k] = rec.fields[m[k]] ? rec.fields[m[k]].value || '' : '';
        });
        this.qeAddr = a;
        this._qeLoaded = true;
    }

    /** 'US' or 'United States' -> 'US' (CountryCode values are codes, their labels the names). */
    countryCodeFor(v) {
        const s = String(v || '').trim();
        const opts = this.picklistOptions('CountryCode');
        const hit = opts.find((o) => o.value === s.toUpperCase()) || opts.find((o) => o.label.toLowerCase() === s.toLowerCase());
        return hit ? hit.value : '';
    }

    /** A lightning-input-address change as Lead / Contact address codes; state codes only repeat across countries. */
    addressCodes(d) {
        const country = this.countryCodeFor(d.country);
        const states = this.stateValuesFor(country);
        const prov = String(d.province || '').trim();
        const province = (states.find((o) => o.value === prov.toUpperCase()) || states.find((o) => o.label.toLowerCase() === prov.toLowerCase()) || {}).value || '';
        return { street: d.street || '', city: d.city || '', province, country, postalCode: d.postalCode || '' };
    }

    /** Address Search or typing in the address: keep the draft as codes. */
    handleQuickEditAddress(e) {
        this.qeAddr = this.addressCodes(e.detail || {});
        this.qeError = '';
    }

    handleQuickEditSubmit(e) {
        e.preventDefault();
        const fields = { ...e.detail.fields };
        if (!String(fields.LastName || '').trim()) {
            this.qeError = 'Last Name is required.';
            return;
        }
        const m = this.qeFieldMap();
        Object.keys(m).forEach((k) => {
            fields[m[k]] = this.qeAddr[k] || null;
        });
        this.qeError = '';
        this.qeSaving = true;
        const form = this.template.querySelector('lightning-record-edit-form.ldr-qe-form');
        if (form) form.submit(fields);
    }

    async handleQuickEditSuccess() {
        this.quickEditOpen = false;
        this.resetQuickEdit();
        const a = this.active;
        this.message = 'Saved to the ' + (a ? a.recordObject : 'record') + '.';
        await this.load(true);
    }

    handleQuickEditError(e) {
        this.qeSaving = false;
        this.qeError = 'Could not save: ' + errorText(e.detail);
    }

    // ------------------------------------------------------------ Link to existing Lead / Contact (canvas 7c73, #160)

    linkFor = null; // submission Id whose "Link to existing" window is open
    linkSuggestions = [];
    // #160: the inbox's own Lead / Contact search (was two record pickers): text, results, the picked record, ▸ details
    linkQ = { Lead: '', Contact: '' };
    linkHits = { Lead: null, Contact: null }; // null = not searched yet
    linkSel = { Lead: null, Contact: null }; // { id, name, sub }
    linkOpen = {}; // result Id -> details shown
    linkAdv = null; // Advanced Search: { kind, q, rows, loading, error }
    _linkSeq = { Lead: 0, Contact: 0, adv: 0 };

    get linkLeadId() {
        return this.linkSel.Lead ? this.linkSel.Lead.id : null;
    }

    get linkContactId() {
        return this.linkSel.Contact ? this.linkSel.Contact.id : null;
    }

    /** Opens the in-page "Link to existing" window (replaces opening the record's edit page). */
    async linkExistingRecord() {
        const a = this.active;
        if (!a) return;
        this.linkFor = a.id;
        this.linkSuggestions = [];
        this.linkQ = { Lead: '', Contact: '' };
        this.linkHits = { Lead: null, Contact: null };
        this.linkSel = { Lead: null, Contact: null };
        this.linkOpen = {};
        this.linkAdv = null;
        // canvas: the Contact search starts with the submission's email
        if (a.email) this.setLinkQuery('Contact', a.email, true);
        try {
            const res = await getLinkSuggestionsApex({ submissionId: a.id, name: a.name });
            if (this.linkFor !== a.id) return;
            this.linkSuggestions = (res || []).map((x) => ({
                ...x,
                key: x.id,
                kindCls: 'ldr-link-kind ' + (x.kind === 'Lead' ? 'ldr-link-kind-lead' : 'ldr-link-kind-contact')
            }));
        } catch (e) {
            this.message = 'Could not load suggested matches: ' + errorText(e);
        }
    }

    get hasLinkDialog() {
        const a = this.active;
        return !!a && this.linkFor === a.id;
    }

    get hasLinkSuggestions() {
        return this.linkSuggestions.length > 0;
    }

    get linkSubline() {
        const a = this.active || {};
        return [a.email || '—', a.phone || 'no phone'].join(' · ');
    }

    get linkCantSave() {
        return (!this.linkLeadId && !this.linkContactId) || this.busy;
    }

    /** A search hit as a result row: name, the sub line, and the details ▸ shows. */
    linkRow(kind, h) {
        const dash = (v) => (v ? String(v) : '—');
        const isLead = kind === 'Lead';
        const open = !!this.linkOpen[h.id];
        return {
            id: h.id,
            name: h.name || '(no name)',
            sub: [h.email, h.company].filter(Boolean).join(' · ') || kind,
            isOpen: open,
            chevron: open ? '▾' : '▸',
            expanded: open ? 'true' : 'false',
            toggleTitle: open ? 'Hide details' : 'Show details',
            details: [
                ['Email', dash(h.email)],
                ['Phone', dash(h.phone)],
                [isLead ? 'Company' : 'Account', dash(h.company)],
                ['City, State', dash([h.city, h.state].filter(Boolean).join(', '))],
                ['Zip', dash(h.zip)],
                [isLead ? 'Lead Status' : 'Type', dash(isLead ? h.status : h.customerType)],
                ['Owner', dash(h.owner)],
                ['Project Coordinator', dash(h.coordinator)]
            ].map(([k, v]) => ({ k, v }))
        };
    }

    /** The Lead and Contact sections of the window (search box or the picked record, results, Show More Results). */
    get linkSections() {
        return ['Lead', 'Contact'].map((kind) => {
            const isLead = kind === 'Lead';
            const q = this.linkQ[kind];
            const hits = this.linkHits[kind];
            const rows = (hits || []).map((h) => this.linkRow(kind, h));
            const sel = this.linkSel[kind];
            return {
                kind,
                label: kind,
                hasSel: !!sel,
                selName: sel ? sel.name : '',
                selSub: sel ? sel.sub : '',
                selCls: 'ldr-link-sel' + (isLead ? ' ldr-link-sel-lead' : ''),
                clearLabel: 'Clear ' + kind,
                q,
                placeholder: 'Search ' + kind + 's by name, email, phone, ' + (isLead ? 'company' : 'account') + ' or zip…',
                ariaLabel: 'Search ' + kind + 's',
                hasRows: rows.length > 0,
                rows,
                noRows: !!hits && !rows.length && q.trim().length >= 2,
                noRowsText: 'No ' + kind + 's match.',
                moreLabel: 'Show More Results for “' + q.trim() + '”',
                showMore: q.trim().length >= 2,
                hint: isLead ? '' : 'Pick one or both. If you pick a Contact, the submission shows as that Contact.'
            };
        });
    }

    handleLinkQuery(e) {
        this.setLinkQuery(e.target.dataset.kind, e.target.value || '');
    }

    /** Typing in a search box: searches after a short pause (the last search wins). Dropdown: up to 5. */
    setLinkQuery(kind, value, now) {
        this.linkQ = { ...this.linkQ, [kind]: value };
        const seq = ++this._linkSeq[kind];
        const term = value.trim();
        clearTimeout(this['_linkTimer' + kind]);
        if (term.length < 2) {
            this.linkHits = { ...this.linkHits, [kind]: null };
            return;
        }
        // eslint-disable-next-line @lwc/lwc/no-async-operation
        this['_linkTimer' + kind] = setTimeout(async () => {
            try {
                const res = await searchLinkRecordsApex({ kind, term, max: 5 });
                if (seq === this._linkSeq[kind]) this.linkHits = { ...this.linkHits, [kind]: res || [] };
            } catch (err) {
                if (seq === this._linkSeq[kind]) {
                    this.linkHits = { ...this.linkHits, [kind]: [] };
                    this.message = errorText(err);
                }
            }
        }, now ? 0 : 300);
    }

    toggleLinkDetails(e) {
        const id = e.currentTarget.dataset.id;
        this.linkOpen = { ...this.linkOpen, [id]: !this.linkOpen[id] };
    }

    /** Clicking a result's name (dropdown or Advanced Search) picks it. */
    pickLinkResult(e) {
        const kind = e.currentTarget.dataset.kind;
        const id = e.currentTarget.dataset.id;
        const pool = this.linkAdv && this.linkAdv.kind === kind ? [...(this.linkAdv.rows || []), ...(this.linkHits[kind] || [])] : this.linkHits[kind] || [];
        const h = pool.find((x) => x.id === id);
        if (!h) return;
        const row = this.linkRow(kind, h);
        this.linkSel = { ...this.linkSel, [kind]: { id, name: row.name, sub: row.sub } };
        this.linkQ = { ...this.linkQ, [kind]: '' };
        this.linkHits = { ...this.linkHits, [kind]: null };
        this.linkAdv = null;
    }

    clearLinkSel(e) {
        this.linkSel = { ...this.linkSel, [e.currentTarget.dataset.kind]: null };
    }

    pickLinkSuggestion(e) {
        const sg = this.linkSuggestions.find((x) => x.id === e.currentTarget.dataset.id);
        if (!sg) return;
        this.linkSel = { ...this.linkSel, [sg.kind === 'Lead' ? 'Lead' : 'Contact']: { id: sg.id, name: sg.name, sub: sg.sub } };
    }

    closeLinkDialog() {
        this.linkFor = null;
        this.linkAdv = null;
    }

    // #160 Advanced Search ("Show More Results"): up to 50 matches with the details needed to pick the right record

    openLinkAdv(e) {
        const kind = e.currentTarget.dataset.kind;
        this.linkAdv = { kind, q: this.linkQ[kind], rows: [], loading: false, error: '' };
        this.runLinkAdv(true);
    }

    closeLinkAdv() {
        this.linkAdv = null;
    }

    handleLinkAdvQuery(e) {
        if (!this.linkAdv) return;
        this.linkAdv = { ...this.linkAdv, q: e.target.value || '' };
        this.runLinkAdv(false);
    }

    runLinkAdv(now) {
        const adv = this.linkAdv;
        if (!adv) return;
        const seq = ++this._linkSeq.adv;
        const term = adv.q.trim();
        clearTimeout(this._linkAdvTimer);
        if (term.length < 2) {
            this.linkAdv = { ...adv, rows: [], loading: false, error: '' };
            return;
        }
        this.linkAdv = { ...adv, loading: true };
        // eslint-disable-next-line @lwc/lwc/no-async-operation
        this._linkAdvTimer = setTimeout(async () => {
            let rows = [];
            let error = '';
            try {
                rows = (await searchLinkRecordsApex({ kind: adv.kind, term, max: LINK_ADV_MAX })) || [];
            } catch (err) {
                error = errorText(err);
            }
            if (seq === this._linkSeq.adv && this.linkAdv) this.linkAdv = { ...this.linkAdv, rows, loading: false, error };
        }, now ? 0 : 300);
    }

    get hasLinkAdv() {
        return !!this.linkAdv;
    }

    get linkAdvView() {
        const adv = this.linkAdv || { kind: 'Lead', q: '', rows: [] };
        const isLead = adv.kind === 'Lead';
        const dash = (v) => (v ? String(v) : '—');
        const n = adv.rows.length;
        return {
            title: isLead ? 'Leads' : 'Contacts',
            q: adv.q,
            placeholder: 'Search ' + (isLead ? 'Leads' : 'Contacts') + ' by name, email, phone, ' + (isLead ? 'company' : 'account') + ' or zip…',
            countText: adv.loading ? 'Searching…' : n + (n === 1 ? ' result' : ' results') + (n >= LINK_ADV_MAX ? ' (first ' + LINK_ADV_MAX + ')' : ''),
            error: adv.error,
            heads: ['', 'Name', 'Email', 'Phone', isLead ? 'Company' : 'Account', 'City, State', 'Zip', isLead ? 'Lead Status' : 'Type', 'Owner', 'Project Coordinator']
                .map((h, i) => ({ key: 'h' + i, h })),
            rows: adv.rows.map((h) => ({
                id: h.id,
                kind: adv.kind,
                cells: [
                    h.name,
                    dash(h.email),
                    dash(h.phone),
                    dash(h.company),
                    dash([h.city, h.state].filter(Boolean).join(', ')),
                    dash(h.zip),
                    dash(isLead ? h.status : h.customerType),
                    dash(h.owner),
                    dash(h.coordinator)
                ].map((v, i) => ({ key: h.id + ':' + i, v }))
            })),
            noRows: !adv.loading && !n && adv.q.trim().length >= 2
        };
    }

    async saveLinkRecord() {
        const a = this.active;
        if (!a || this.linkCantSave) return;
        this.busy = true;
        try {
            await linkSubmissionApex({ submissionId: a.id, leadId: this.linkLeadId, contactId: this.linkContactId });
            this.linkFor = null;
            this.dispatchEvent(new ShowToastEvent({ title: 'Linked', message: 'Lead / Contact set on the ' + (a.isEstimate ? 'Instant Estimate' : 'Form Submission') + '.', variant: 'success' }));
        } catch (e) {
            this.message = 'Link failed: ' + errorText(e);
        } finally {
            this.busy = false;
        }
        await this.load(true);
    }

    /** Activity item click: in-page preview (type, subject, who, when, Description). */
    openActivityPreview(e) {
        const id = e.currentTarget.dataset.id;
        const act = this.activity.find((x) => x.key === id);
        if (!act) return;
        this.activityPreview = {
            id: act.key,
            kind: act.kindLabel,
            subject: act.label || '(no subject)',
            who: act.who || '',
            when: act.whenLabel,
            body: act.body || 'No comments or body on this record.',
            isEvent: act.kind === 'event'
        };
    }

    closeActivityPreview() {
        this.activityPreview = null;
    }

    /**
     * v6g2 (Aqil): a click on the dark area around a popup closes it, doing what its own Close / Cancel / × does (the
     * overlay's data-close names that handler). Only when the press started on the dark area too, so selecting text
     * in a field and letting go outside doesn't close it; and not while something is saving.
     */
    overlayDown(e) {
        this._overlayPress = e.target === e.currentTarget ? e.currentTarget.dataset.close || '' : '';
    }

    overlayClick(e) {
        const fn = e.currentTarget.dataset.close;
        const own = e.target === e.currentTarget && !!fn && this._overlayPress === fn;
        this._overlayPress = '';
        if (!own || this.busy || this.qeSaving) return;
        if (OVERLAY_CLOSERS.includes(fn)) this[fn]();
    }

    openActivityRecord() {
        const p = this.activityPreview;
        if (!p) return;
        this.activityPreview = null;
        this.openRecord(p.id, p.isEvent ? 'Event' : 'Task');
    }

    get hasActivityPreview() {
        return !!this.activityPreview;
    }

    get refreshLinkLabel() {
        return this.refreshingLink ? 'Checking…' : '↻ Refresh';
    }

    get conflictNote() {
        return 'Nothing was overwritten. The app re-checked Project Coordinator before saving.';
    }

    /** Re-checks Salesforce for a Lead/Contact newly linked to an unlinked submission (reloads the queue). */
    async refreshLinkCheck() {
        this.refreshingLink = true;
        try {
            await this.load(true);
        } finally {
            this.refreshingLink = false;
        }
        const a = this.active;
        this.message = a && a.isUnlinked
            ? 'Still not linked. Salesforce/Eloqua usually links a Lead or Contact shortly after the form comes in. Try again in a minute, or use Create Lead.'
            : 'Now linked to a Lead or Contact.';
    }

    // ------------------------------------------------------------ Create Lead (built into the inbox)

    /**
     * Opens the inbox's own Create Lead form (not Salesforce's New Lead page), pre-filled from the submission.
     * Saving inserts the Lead, links it to the submission (Lead__c) and, when claimed, copies the claim onto it.
     */
    startCreateLead() {
        const a = this.active;
        if (!a) return;
        const s = a.raw;
        const first = s.First_Name__c || '';
        const last = s.Last_Name__c || '';
        const full = [first, last].filter(Boolean).join(' ') || a.name || '';
        const country = COUNTRY_CODES[(s.Country__c || '').trim().toLowerCase()] ||
            (/^\d{5}/.test(s.Zip_or_Postal_Code__c || '') ? 'US' : '');
        const typeOk = this.leadTypeValues.includes(s.Customer_Type__c);
        this.leadForm = {
            FirstName: first,
            LastName: last,
            Company: s.Company__c || full,
            Email: s.Email_Address__c || '',
            Phone: s.Phone_Number__c || '',
            Status: 'New',
            Type__c: typeOk || !this.leadTypeValues.length ? s.Customer_Type__c || '' : '',
            CountryCode: country,
            Street: '',
            City: '',
            StateCode: '',
            PostalCode: s.Zip_or_Postal_Code__c || ''
        };
        this.leadFormTried = false;
        this.creatingLead = true;
        this.message = undefined;
    }

    cancelCreateLead() {
        this.creatingLead = false;
    }

    handleLeadField(e) {
        const f = e.target.dataset.field;
        const v = e.detail && e.detail.value !== undefined ? e.detail.value : e.target.value;
        const next = { ...this.leadForm, [f]: v || '' };
        if (f === 'CountryCode' && !this.stateValuesFor(next.CountryCode).some((o) => o.value === next.StateCode)) {
            next.StateCode = ''; // State follows Country
        }
        this.leadForm = next;
    }

    /** #160: Create Lead's address (Address Search pick or typing), as codes like Quick Edit. */
    handleLeadAddress(e) {
        const a = this.addressCodes(e.detail || {});
        this.leadForm = { ...this.leadForm, CountryCode: a.country, StateCode: a.province, Street: a.street, City: a.city, PostalCode: a.postalCode };
    }

    get leadTypeValues() {
        const p = this.leadPicklists.Type__c;
        return p ? p.values.map((v) => v.value) : [];
    }

    picklistOptions(field) {
        const p = this.leadPicklists[field];
        return p ? p.values.map((v) => ({ label: v.label, value: v.value })) : [];
    }

    get leadStatusOptions() {
        return this.picklistOptions('Status');
    }

    get leadTypeOptions() {
        return this.picklistOptions('Type__c');
    }

    /** US, Canada, Mexico first, then the rest in Setup order. */
    get leadCountryOptions() {
        const all = this.picklistOptions('CountryCode');
        const first = FIRST_COUNTRIES.map((c) => all.find((o) => o.value === c)).filter(Boolean);
        return [...first, ...all.filter((o) => !FIRST_COUNTRIES.includes(o.value))];
    }

    stateValuesFor(countryCode) {
        const p = this.leadPicklists.StateCode;
        if (!p || !countryCode || !p.controllerValues) return [];
        const idx = p.controllerValues[countryCode];
        if (idx === undefined) return [];
        return p.values.filter((v) => (v.validFor || []).includes(idx)).map((v) => ({ label: v.label, value: v.value }));
    }

    // ------------------------------------------------------------ Project Site address search (canvas #134)

    /** The Project Site address in the LDR fields draft (else as saved on the Lead). Full names, as the picklists store. */
    get projectAddr() {
        const p = this.draft.pre || {};
        const v = (f) => (Object.prototype.hasOwnProperty.call(p, f) ? p[f] || '' : this.preBase[f] || '');
        return {
            street: v('Project_Site_Street__c'),
            city: v('Project_Site_City__c'),
            province: v('Project_Site_State__c'),
            postalCode: v('Project_Site_Zip_Code__c'),
            country: v('Project_Site_Country__c')
        };
    }

    /** Values of a dependent Lead picklist for one controlling value (validFor), e.g. Project Site State for a country. */
    dependentOptions(field, ctrl) {
        const p = this.leadPicklists[field];
        if (!p || !ctrl || !p.controllerValues) return [];
        const idx = p.controllerValues[ctrl];
        if (idx === undefined) return [];
        return p.values.filter((x) => (x.validFor || []).includes(idx)).map((x) => ({ label: x.label, value: x.value }));
    }

    get projectCountryOptions() {
        const all = this.picklistOptions('Project_Site_Country__c');
        const first = ['United States', 'Canada', 'Mexico'].map((n) => all.find((o) => o.value === n)).filter(Boolean);
        return [...first, ...all.filter((o) => !first.includes(o))];
    }

    get projectStateOptions() {
        return this.dependentOptions('Project_Site_State__c', this.projectAddr.country);
    }

    /** 'US' or 'United States' -> a Project_Site_Country__c value (full name), else ''. */
    projectCountryName(v) {
        const s = String(v || '').trim();
        const names = this.picklistOptions('Project_Site_Country__c').map((o) => o.value);
        const eq = (n, x) => n.toLowerCase() === x.toLowerCase();
        let hit = names.find((n) => eq(n, s));
        if (!hit) {
            const cc = this.picklistOptions('CountryCode').find((o) => o.value === s.toUpperCase());
            if (cc) hit = names.find((n) => eq(n, cc.label));
        }
        return hit || '';
    }

    /** A state name or code -> a Project_Site_State__c value for that country (codes repeat across countries: NL, ME). */
    projectStateName(countryName, rawCountry, raw) {
        const s = String(raw || '').trim();
        const opts = this.dependentOptions('Project_Site_State__c', countryName);
        const byName = opts.find((o) => o.value.toLowerCase() === s.toLowerCase());
        if (byName) return byName.value;
        const code = this.stateValuesFor(this.countryCodeFor(rawCountry || countryName)).find((o) => o.value === s.toUpperCase());
        const hit = code && opts.find((o) => o.value.toLowerCase() === code.label.toLowerCase());
        return hit ? hit.value : '';
    }

    /**
     * Address Search pick or typing: map to the Project Site picklists (full names) and the field lengths (Street / City
     * 100, Zip 12), put it in the draft; Save writes it. Values that don't fit are left out with a message, never fail.
     */
    handleProjectAddress(e) {
        // v5.7b: only the component's own change event (with the address in detail); a plain change event that bubbles
        // up from an inner input would otherwise blank every part of the address
        if (!e.detail) return;
        const d = e.detail;
        const before = this.projectAddr;
        const notes = [];
        const country = this.projectCountryName(d.country);
        if (d.country && !country) notes.push('Country not set: ' + d.country + ' isn’t a Project Site Country value');
        const state = d.province && country ? this.projectStateName(country, d.country, d.province) : '';
        if (d.province && !state) notes.push('State not set: ' + d.province + ' isn’t a Project Site State value');
        const cut = (v, n, label) => {
            const s = String(v || '').replace(/\s*\r?\n\s*/g, ', ').trim();
            if (s.length <= n) return s;
            notes.push(label + ' trimmed to ' + n + ' characters (Salesforce limit)');
            return s.slice(0, n);
        };
        const street = cut(d.street, 100, 'Street');
        const city = cut(d.city, 100, 'City');
        const zip = cut(d.postalCode, 12, 'Zip');
        this.draft = {
            ...this.draft,
            pre: {
                ...this.draft.pre,
                Project_Site_Country__c: country,
                Project_Site_State__c: state,
                Project_Site_Street__c: street,
                Project_Site_City__c: city,
                Project_Site_Zip_Code__c: zip
            }
        };
        // v5.7b: only the part that changed drops off the "Filled in by Populate Project" line
        this.clearAutoFilled({
            Project_Site_Country__c: country,
            Project_Site_State__c: state,
            Project_Site_Street__c: street,
            Project_Site_City__c: city,
            Project_Site_Zip_Code__c: zip
        });
        // A lookup pick changes several parts at once; plain typing changes one (no message for that).
        const after = { street, city, postalCode: zip, country };
        const changed = ['street', 'city', 'postalCode', 'country'].filter((k) => (before[k] || '') !== after[k]).length;
        if (changed >= 2 || notes.length) {
            this.message =
                (changed >= 2 ? 'Project address filled from search: ' + [street, city, [state, zip].filter(Boolean).join(' '), country].filter(Boolean).join(', ') + '. ' : '') +
                (notes.length ? notes.join('. ') + '. ' : '') +
                'Click Save to write it to the Lead.';
        }
    }

    get leadStateOptions() {
        return this.stateValuesFor(this.leadForm.CountryCode);
    }

    get leadStateDisabled() {
        return this.leadStateOptions.length === 0;
    }

    get leadPicklistsMissing() {
        return !this.leadPicklists.CountryCode;
    }

    get leadFormMissing() {
        const req = [['FirstName', 'First Name'], ['LastName', 'Last Name'], ['Company', 'Company'], ['Status', 'Lead Status'],
            ['Type__c', 'Customer Type'], ['CountryCode', 'Country'], ['PostalCode', 'Zip / Postal Code']];
        return req.filter(([k]) => !(this.leadForm[k] || '').trim()).map(([, label]) => label);
    }

    get showLeadFormMissing() {
        return this.leadFormTried && this.leadFormMissing.length > 0;
    }

    get leadFormMissingText() {
        return 'Required: ' + this.leadFormMissing.join(', ') + '.';
    }

    async submitCreateLead() {
        const a = this.active;
        if (!a) return;
        this.leadFormTried = true;
        if (this.leadFormMissing.length) {
            // #123: the missing required fields get the field's own red error border, next to the message.
            this.template.querySelectorAll('.ldr-lead-grid lightning-input, .ldr-lead-grid lightning-combobox').forEach((el) => {
                if (typeof el.reportValidity === 'function') el.reportValidity();
            });
            return;
        }
        await this.run(async () => {
            await createLeadApex({ submissionId: a.id, fields: { ...this.leadForm } });
            this.creatingLead = false;
            this.message = 'Lead created and linked to this submission' +
                (a.claimedById ? '. Project Coordinator = ' + (a.claimedByName || 'the claimer') + ', Lead Funnel Timestamp = today.' : '.');
        });
    }

    openRelated(e) {
        this.openRecord(e.currentTarget.dataset.id);
    }

    async claim() {
        const a = this.active;
        if (!a) return;
        let claimed = false;
        await this.run(async () => {
            try {
                this.savingLeadFields = true;
                const extra = await claimApex({ submissionId: a.id });
                claimed = true;
                if (a.isProspect) this.prospectRows = this.prospectRows.filter((x) => x.id !== a.id);
                await this.afterClaimChange(a);
                const also = extra
                    ? ' ' + (extra === 1
                        ? 'Another unclaimed submission from ' + a.name + ' has been claimed as well.'
                        : extra + ' other unclaimed submissions from ' + a.name + ' have been claimed as well.')
                    : '';
                const status = DECIDED_STATUSES.includes(a.leadStatus)
                    ? ' Status was ' + a.leadStatus + ' and has been reset to New. Move it back to ' + a.leadStatus + ' if that wasn’t intended.'
                    : this.isStaleStatus(a)
                      ? ' Status was ' + a.leadStatus + ' from an earlier cycle and has been reset to New.'
                      : '';
                const blankContactStatus = a.isContactLinked && !a.leadStatus ? ' Lead Funnel Status was blank and is now New.' : '';
                if (a.coordinatorId && a.coordinatorId !== this.meId) {
                    this.message =
                        'Claimed. You took over Project Coordinator from ' + a.coordinatorName +
                        '. Review and connect with them before working it. Lead Funnel Timestamp = today.' + status + blankContactStatus + also;
                } else if (a.isUnlinked) {
                    this.message = 'Claimed. No Lead or Contact is linked yet, so only the submission is claimed.' + also;
                } else {
                    this.message = 'Claimed. You are now the ' + a.recordObject + '’s Project Coordinator. Lead Funnel Timestamp = today.' + status + blankContactStatus + also;
                }
            } catch (e) {
                const msg = errorText(e);
                if (msg.startsWith(CONFLICT_PREFIX)) {
                    this.conflictMsg = msg.substring(CONFLICT_PREFIX.length) + ' claimed this lead a few seconds before you.';
                    return;
                }
                throw e;
            } finally {
                this.savingLeadFields = false;
            }
        });
        // v6g (Aqil): the list stays on its tab after a claim (canvas #148's move to Mine removed); the claimed record
        // stays open, and its header's "Go to Mine" link switches the list if wanted.
        return claimed;
    }

    /**
     * Claim and release change Project Coordinator and Lead Funnel Timestamp in Apex, outside Lightning Data Service,
     * so the record-edit-form would keep showing the old values. Tell LDS the Lead changed and reload Lead History.
     */
    async afterClaimChange(a) {
        if (!a.recordId) return;
        await this.refreshLeadForm(a.recordId);
        this.loadTimeline(a);
    }

    get showSavingIndicator() {
        return this.savingLeadFields;
    }

    async assignToCoordinator() {
        const a = this.active;
        if (!a) return;
        await this.run(async () => {
            try {
                await assignToCoordinatorApex({ submissionId: a.id });
                this.message =
                    'Assigned this submission to ' +
                    a.coordinatorName +
                    '. No notification was sent. It shows as assigned in their Mine tab when Form Submission field history is on.';
            } catch (e) {
                const msg = errorText(e);
                if (msg.startsWith(CONFLICT_PREFIX)) {
                    this.conflictMsg = msg.substring(CONFLICT_PREFIX.length) + ' claimed this lead a few seconds before you.';
                    return;
                }
                throw e;
            }
        });
    }

    // ------------------------------------------------------------ Junk (canvas dd24)

    get junkReasonItems() {
        return JUNK_REASONS.map((reason) => ({ key: reason, reason }));
    }

    toggleJunkMenu() {
        this.junkMenuOpen = !this.junkMenuOpen;
    }

    /** Same sender's other unclaimed, unlinked form submissions (junk tends to arrive in bursts). */
    junkGroup(a, wantJunk) {
        const email = (a.email || '').toLowerCase();
        if (!email || !a.isUnlinked) return [a.id];
        const sibs = this.rows.filter(
            (x) =>
                x.id !== a.id &&
                !x.isConfigurator &&
                !x.isProspect &&
                x.isUnlinked &&
                (x.email || '').toLowerCase() === email &&
                (wantJunk ? !!x.junkReason && x.claimedById === this.viewerId : !x.claimedById && !x.junkReason)
        );
        return [a.id, ...sibs.map((x) => x.id)];
    }

    async markJunk(e) {
        const a = this.active;
        const reason = e.currentTarget.dataset.reason;
        if (!a || !reason) return;
        this.junkMenuOpen = false;
        const ids = this.junkGroup(a, false);
        await this.run(async () => {
            const n = await markJunkApex({ submissionIds: ids, reason });
            const others = n - 1;
            this.dispatchEvent(
                new ShowToastEvent({
                    title: 'Marked as junk',
                    message:
                        reason +
                        '. Claimed by you and moved to Finished.' +
                        (a.isUnlinked ? ' No Lead or Contact was created or changed.' : '') +
                        (others > 0 ? ' ' + others + ' other submission' + (others === 1 ? '' : 's') + ' from the same email ' + (others === 1 ? 'was' : 'were') + ' marked too.' : '') +
                        (a.isUnlinked
                            ? ''
                            : ' The ' + (a.isContactLinked ? 'Contact' : 'Lead') + '’s Project Coordinator is you, Status Wrong profile, Outcome ' + (JUNK_OUTCOMES[reason] || 'Other') + ', Lead Funnel Timestamp today.'),
                    variant: 'success'
                })
            );
        });
    }

    async restoreJunk() {
        const a = this.active;
        if (!a || !a.isJunk) return;
        const ids = this.junkGroup(a, true);
        await this.run(async () => {
            await restoreJunkApex({ submissionIds: ids });
            const row = this.rows.find((x) => x.id === a.id) || {};
            this.dispatchEvent(
                new ShowToastEvent({
                    title: 'Restored',
                    message: 'It is back in Unclaimed.' + (row.junkHasPrev ? ' Project Coordinator, Status, Outcome and Lead Funnel Timestamp are back to what they were.' : ''),
                    variant: 'success'
                })
            );
        });
    }

    /**
     * Status buttons (canvas d84b, #94B): Working / Nurture / Unreachable / Disqualified set Lead Status (Contact: Lead
     * Funnel Status) and Lead Funnel Timestamp = today (Pacific). Reuses saveLeadFields (claimed, linked, USER_MODE);
     * Outcome is passed through unchanged. Unsaved LDR field edits must be saved or cancelled
     * first, because the reload after the write resets the form.
     */
    async quickStatus(e) {
        const a = this.active;
        const value = e.currentTarget.dataset.status;
        if (!a || !value || !QUICK_STATUSES.includes(value)) return;
        const btn = (a.statusButtons || []).find((b) => b.value === value);
        if (!btn || btn.off) return;
        if (a.isUnlinked) {
            // v6g7: no Lead / Contact yet: "#<status>" on the submission (claims it if it isn't yours yet)
            await this.run(async () => {
                await setUnlinkedStatusApex({ submissionId: a.id, status: value });
                this.dispatchEvent(
                    new ShowToastEvent({
                        title: 'LDR Inbox',
                        message: '#' + value + ' added to Comments' + (a.isMine ? '' : ' and claimed') + '.' +
                            (UNLINKED_DONE.includes(value) ? ' It moves to Finished.' : ''),
                        variant: 'success'
                    })
                );
            });
            return;
        }
        if (this.ldrDirty) {
            this.message = 'Save or cancel your changes in LDR fields first.';
            return;
        }
        const row = this.rows.find((x) => x.id === a.id) || {};
        await this.run(async () => {
            await saveLeadFields({
                submissionId: a.id,
                status: value,
                outcome: row.leadOutcome || null,
                ldrProjectName: null,
                ldrNotes: null,
                preConversion: { Lead_Funnel_Time_Stamp__c: todayPacific() }
            });
            await this.refreshLeadForm(a.recordId);
            this.dispatchEvent(
                new ShowToastEvent({
                    title: 'LDR Inbox',
                    message:
                        (a.isContactLinked ? 'Lead Funnel Status' : 'Status') +
                        ' set to ' +
                        value +
                        ' and Lead Funnel Timestamp set to today.' +
                        (value === 'Nurture' ? ' Handed to email marketing; this lead will no longer show in your queues.' : '') +
                        (value === 'Qualified' ? ' It moves to Finished.' : ''),
                    variant: 'success'
                })
            );
        });
    }

    async release() {
        const a = this.active;
        if (!a) return;
        if (a.isJunk) {
            await this.restoreJunk(); // a junk row: Release = Restore
            return;
        }
        await this.run(async () => {
            this.savingLeadFields = true;
            try {
                await releaseApex({ submissionId: a.id });
                await this.afterClaimChange(a);
            } finally {
                this.savingLeadFields = false;
            }
            this.message = a.isContactLinked
                ? 'Released back to the Unclaimed queue. The Contact’s Project Coordinator goes back to what it was before your claim. Lead Funnel Timestamp is left as is (Contact field history doesn’t track it).'
                : 'Released back to the Unclaimed queue. The Lead’s Project Coordinator and Lead Funnel Timestamp go back to what they were before your claim.';
        });
    }

    async save() {
        const a = this.active;
        if (!a) return;
        const exiting = !!this.draft.status && !ACTIVE_STATUSES.includes(this.draft.status) && ACTIVE_STATUSES.includes(a.leadStatus);
        return this.run(async () => {
            await saveLeadFields({
                submissionId: a.id,
                status: this.draft.status,
                outcome: this.draft.outcome,
                ldrProjectName: null,
                ldrNotes: null,
                preConversion: this.draft.pre
            });
            await this.refreshLeadForm(a.recordId);
            this.message = exiting
                ? 'Saved. Status is ' + this.draft.status + ', so this has left Mine / Team (it stays on the ' + a.recordObject + ' record).'
                : 'Saved to the ' + a.recordObject + '.';
        });
    }

    /** Converted-after-submission Contacts: save Lead Funnel Status without claiming. */
    async saveStatusOnly() {
        const a = this.active;
        if (!a) return;
        await this.run(async () => {
            await saveStatusWithoutClaim({
                submissionId: a.id,
                status: this.draft.status,
                outcome: this.draft.outcome || null
            });
            await this.refreshLeadForm(a.recordId);
            this.message = ACTIVE_STATUSES.includes(this.draft.status) || !this.draft.status
                ? 'Lead Funnel Status saved. It stays in Unclaimed.'
                : 'Lead Funnel Status saved as ' + this.draft.status + ', so it has left the list.';
        });
    }

    // ------------------------------------------------------------ Reassign / Claim from a teammate

    askReassign() {
        const a = this.active;
        if (!a || !a.canReassign) return;
        this.confirm = {
            kind: 'reassign',
            text: 'This ' + a.recordWordLower + ' will be reassigned to ' + a.reassignTo + '. Would you like to proceed?'
        };
    }

    askClaimFrom() {
        const a = this.active;
        if (!a || !a.isOthers) return;
        this.confirm = {
            kind: 'claimFrom',
            text: 'This ' + a.recordWordLower + ' will be claimed from ' + a.claimedByName + '. Would you like to proceed?'
        };
    }

    get hasConfirm() {
        return !!this.confirm;
    }

    confirmNo() {
        this.confirm = null;
    }

    async confirmYes() {
        const a = this.active;
        const c = this.confirm;
        this.confirm = null;
        if (!a || !c) return;
        if (c.kind === 'reassign') {
            await this.run(async () => {
                const to = await reassignApex({ submissionId: a.id });
                await this.afterClaimChange(a);
                this.message = 'Reassigned to ' + to + ': Project Coordinator restored and Claimed By = ' + to + '. ' +
                    (a.isContactLinked
                        ? 'Lead Funnel Timestamp left as is (Contact field history doesn’t track it).'
                        : 'Lead Funnel Timestamp restored to its value before your claim.');
            });
        } else {
            await this.run(async () => {
                try {
                    await claimFromApex({ submissionId: a.id, expectedClaimerId: a.claimedById });
                    await this.afterClaimChange(a);
                    this.message = 'Claimed from ' + a.claimedByName + ': you are now Project Coordinator, Lead Funnel Timestamp = today. Reassign gives it back.';
                } catch (e) {
                    const msg = errorText(e);
                    if (msg.startsWith(CONFLICT_PREFIX)) {
                        this.conflictMsg = 'It changed hands meanwhile: ' + msg.substring(CONFLICT_PREFIX.length) + ' holds it now.';
                        return;
                    }
                    throw e;
                }
            });
        }
    }

    // ------------------------------------------------------------ Hand-off

    /**
     * Lead rows: opens the Convert Lead - LDR flow FIRST, synchronously in the click (no await before it, so the
     * browser doesn't block or blank it), with a relative URL, then writes Status = Qualified / Outcome =
     * Hand-off to Rep. Disabled while there are unsaved changes, so the flow reads saved values.
     * Contact rows (no Lead to convert): only Status / Outcome; Attach to Opportunity (#119) creates the Project /
     * Opportunity.
     */
    handoff() {
        const a = this.active;
        if (!a) return;
        if (this.ldrDirty) {
            this.message = 'Save your changes first: the Convert Lead flow reads what is saved on the Lead.';
            return;
        }
        // Status / Outcome first (a converted Lead can't be edited), then the Convert Lead - LDR flow runs in a window
        // over the inbox (lightning-flow), so the inbox stays open.
        this.run(async () => {
            await handoffApex({ submissionId: a.id, ldrProjectName: null, ldrNotes: null, preConversion: {} });
            await this.refreshLeadForm(a.recordId);
            if (a.convertUrl) {
                this.convertState = {
                    id: a.id,
                    leadId: a.leadId,
                    name: a.name,
                    firstName: firstName(a.name),
                    step: 'flow',
                    fileLinks: this.formFiles((x) => x.leadId === a.leadId),
                    uploaded: []
                };
                this.message = 'Status = Qualified, Outcome = Hand-off to Rep. Converting here; the inbox stays open.';
            } else {
                this.message = 'Lead Funnel Status = Qualified, Outcome = Hand-off to Rep. This is an existing Contact, so there is no Lead to convert; use Copy FETR for the rep email.';
            }
        });
    }

    // ------------------------------------------------------------ Convert Lead window (canvas #129)

    /**
     * Form attachments from every loaded submission that matches (the Lead's, taken before conversion, for the Convert
     * Files step; the Contact's for Attach to Opportunity), each file once.
     */
    formFiles(matches) {
        const seen = new Set();
        const out = [];
        this.rows
            .filter((x) => matches(x) && !x.isConfigurator)
            .forEach((x) =>
                parseAttachments(x.raw.Attachments__c).forEach((f) => {
                    if (!seen.has(f.url)) {
                        seen.add(f.url);
                        out.push({ ...f, key: 'cf' + out.length });
                    }
                })
            );
        return out;
    }

    get hasConvertFlow() {
        return !!this.convertState && this.convertState.id === this.activeId;
    }

    get convertIsFlow() {
        return !!this.convertState && this.convertState.step === 'flow';
    }

    get convertIsFiles() {
        return !!this.convertState && this.convertState.step === 'files';
    }

    /**
     * v5 (Zaid's flow update): recordId is the Lead Id, and skipNavigation = true stops the flow navigating away at
     * the end, so the inbox's Files step takes over. Needs that flow version: lightning-flow errors on an input the
     * flow doesn't have.
     */
    get convertFlowInputs() {
        return this.convertState
            ? [
                  { name: 'recordId', type: 'String', value: this.convertState.leadId },
                  { name: 'skipNavigation', type: 'Boolean', value: true }
              ]
            : [];
    }

    get convertFlowUrl() {
        return this.convertState ? leadConvertFlowUrl(this.convertState.leadId) : '';
    }


    get convertHasUploads() {
        return !!this.convertState && this.convertState.uploaded.length > 0;
    }

    get convertUploadsText() {
        return this.convertState ? this.convertState.uploaded.join(', ') : '';
    }

    get convertDoneLabel() {
        return this.convertHasUploads ? 'Attach Files & Open Contact' : 'Open Contact';
    }

    /**
     * lightning-flow fires statuschange on every screen; each change re-reads the Lead (non-cacheable Apex), and as
     * soon as it's converted the flow's own summary screen (cards, FETR Email Form, Go to Leads) is replaced by the
     * inbox's Files step. v5: when the flow finishes, its OpportunityId output (Zaid's flow update; also AccountId,
     * ContactId, ProjectId) picks the Opportunity for the Files step.
     */
    async handleConvertFlowStatus(e) {
        const st = e.detail && e.detail.status;
        if (st === 'ERROR') {
            this.message = 'The Convert Lead flow hit an error. Open it from the link under the Hand-off button.';
            return;
        }
        await this.checkConversion(st === 'FINISHED' || st === 'FINISHED_SCREEN', flowOutput(e.detail, 'OpportunityId'));
    }

    /**
     * One check at a time: a statuschange (or ×) that arrives while a check is still running waits for it, so the
     * conversion is handled (and the Contact qualified) once.
     */
    checkConversion(flowEnded, flowOpportunityId = null) {
        const prev = this._convertCheck || Promise.resolve();
        const next = prev.catch(() => {}).then(() => this.runConversionCheck(flowEnded, flowOpportunityId));
        this._convertCheck = next;
        return next;
    }

    async runConversionCheck(flowEnded, flowOpportunityId = null) {
        const cs = this.convertState;
        if (!cs || cs.step !== 'flow') return;
        let res;
        try {
            res = await getLeadConversionApex({ leadId: cs.leadId, flowOpportunityId });
        } catch (err) {
            if (flowEnded) this.message = 'Couldn’t check the conversion: ' + errorText(err);
            return;
        }
        if (this.convertState !== cs) return; // closed or restarted meanwhile
        if (res && res.isConverted) {
            // canvas #150: the new Contact's Lead Funnel Status = Qualified (only while blank), before the Files step
            // so the reload shows it. Once per conversion: the step leaves 'flow' right after. A failure is shown in
            // the Files step but doesn't block it.
            let qualifyNote = '';
            let qualifyError = '';
            try {
                if (await qualifyConvertedContactApex({ leadId: cs.leadId })) qualifyNote = 'Lead Funnel Status set to Qualified.';
            } catch (err) {
                qualifyError = 'Lead Funnel Status wasn’t set to Qualified: ' + errorText(err);
            }
            if (this.convertState !== cs) return; // closed meanwhile
            this.convertState = {
                ...cs,
                step: 'files',
                contactId: res.contactId,
                opportunityId: res.opportunityId,
                opportunityName: res.opportunityName || '',
                qualifyNote,
                qualifyError
            };
            // No Opportunity (e.g. "Don't create a Project upon conversion"): nothing to attach files to.
            if (!res.opportunityId) await this.finishConversion();
        } else if (flowEnded) {
            this.convertState = null;
            this.message = 'The Convert Lead flow finished without converting the Lead.';
        }
    }

    handleConvertUpload(e) {
        const files = (e.detail && e.detail.files) || [];
        if (!this.convertState) return;
        this.convertState = { ...this.convertState, uploaded: this.convertState.uploaded.concat(files.map((f) => f.name)) };
    }

    /**
     * "Attach Files & Open Contact" / "Open Contact" (and × after conversion): closes the window and leaves the LDR on
     * the Contact in the inbox. The reload re-points the row to the Contact; selecting it again re-reads its open
     * opportunities, which is what used to need a full browser refresh. (Uploaded files are already on the
     * Opportunity: lightning-file-upload links each file as it uploads.)
     */
    async finishConversion() {
        const cs = this.convertState;
        if (!cs) return;
        this.convertState = null;
        this._resetAfterLoad = true;
        this.formNonce += 1;
        this.preBase = {};
        await this.load(true);
        if (this.rows.some((x) => x.id === cs.id)) {
            this._relatedFor = null;
            this.selectRow(cs.id);
        }
        await this.refreshLeadForm(cs.contactId);
        const n = cs.uploaded.length;
        this.dispatchEvent(
            new ShowToastEvent({
                title: 'LDR Inbox',
                variant: 'success',
                message:
                    'Converted. ' + cs.name + ' is now a Contact, shown here' +
                    (cs.opportunityName ? ', with ' + cs.opportunityName + ' under Open opportunities' : '') + '. ' +
                    (cs.qualifyNote ? cs.qualifyNote + ' ' : '') +
                    (n ? n + ' file' + (n > 1 ? 's' : '') + ' attached to the Opportunity.' : 'No files attached.')
            })
        );
        // Shown in the Files step too; repeated here for a conversion with no Opportunity (no Files step).
        if (cs.qualifyError) this.message = cs.qualifyError;
    }

    async closeConvertFlow() {
        const cs = this.convertState;
        if (!cs) return;
        if (cs.step === 'files') {
            await this.finishConversion();
            return;
        }
        // × on the flow's last screen, before its statuschange arrived: it may already have converted.
        await this.checkConversion(false);
        if (this.convertState && this.convertState.step === 'files') {
            await this.finishConversion();
            return;
        }
        this.convertState = null;
        this.message = 'Convert window closed; the Lead isn’t converted.';
    }

    // ------------------------------------------------------------ Attach to Opportunity (canvas #119)

    /**
     * Contact rows in Mine: runs the "Contact: New Opportunity" screen flow (Contact_New_Opportunity, the Contact page's
     * New Opportunity button) in a window over the inbox: create a Project, or pick an existing one, and attach the
     * Contact to a new Opportunity on it. The flow has no outputs, so on finish the open opportunities are re-read: the
     * newest one's project becomes this submission's FETR project (#120), and when it was made in the last 30 minutes
     * the window moves to a Files step on it (form files, Upload Files, KBMax quotes), like Convert's.
     */
    /**
     * v5.7: Contacts' button on the Hand-off line (replaces Hand-off). Same write as Hand-off (Lead Funnel Status =
     * Qualified, Outcome = Hand-off to Rep) plus Lead Funnel Timestamp = today (Pacific), then the Attach to Opportunity
     * flow opens. The status is set even if the LDR closes the flow without finishing it.
     */
    async attachOppHandoff() {
        const a = this.active;
        if (!a || !a.canAttachOpp) return;
        if (this.ldrDirty) {
            this.message = 'Save or cancel your changes in LDR fields first.';
            return;
        }
        const ok = await this.run(async () => {
            await handoffApex({
                submissionId: a.id,
                ldrProjectName: null,
                ldrNotes: null,
                preConversion: { Lead_Funnel_Time_Stamp__c: todayPacific() }
            });
        });
        if (!ok) return;
        this.attachOpp = { id: a.id, contactId: a.contactId, step: 'flow', uploaded: [] };
        this.message = 'Lead Funnel Status = Qualified, Outcome = Hand-off to Rep, Lead Funnel Timestamp = today. Attach the Contact to an Opportunity in the window.';
    }

    get hasAttachOppFlow() {
        const a = this.active;
        return !!a && !!this.attachOpp && this.attachOpp.id === a.id && a.canAttachOpp;
    }

    get attachOppIsFlow() {
        return !!this.attachOpp && this.attachOpp.step === 'flow';
    }

    get attachOppIsFiles() {
        return !!this.attachOpp && this.attachOpp.step === 'files';
    }

    get attachOppInputs() {
        const a = this.active;
        if (!a || !a.contactId) return [];
        // v5 (Zaid's flow update, active in production 2026-10-29): skipNavigation stops the flow navigating away when
        // it finishes, so the inbox stays open. It's a text variable in this flow (Convert_Lead's is a Boolean).
        // The flow's Selected_KBMax_Rows input isn't sent any more (2026-10-30): the flow joins every quote it's given to
        // the new Opportunity, so the LDR picks the quotes in the Files step instead.
        return [
            { name: 'recordId', type: 'SObject', value: { Id: a.contactId } },
            { name: 'ContactId', type: 'String', value: a.contactId },
            { name: 'skipNavigation', type: 'String', value: 'true' }
        ];
    }

    async handleAttachOppStatus(e) {
        const st = e.detail && e.detail.status;
        if (st === 'FINISHED' || st === 'FINISHED_SCREEN') {
            const ao = this.attachOpp;
            const r = ao && this.rows.find((x) => x.id === ao.id);
            if (!r) {
                this.attachOpp = null;
                return;
            }
            const opps = await this.loadContactOpps(r);
            const newest = opps.slice().sort((x, y) => (toTime(y.createdDate) || 0) - (toTime(x.createdDate) || 0))[0];
            if (newest) {
                this.fetrProjectPick = { ...this.fetrProjectPick, [r.id]: newest.projectId || newest.projectName || newest.recordId };
            }
            this.message = 'Opportunity created' + (newest ? ': ' + newest.name : '') + '. The FETR now uses this project for this submission.';
            const fresh = newest && Date.now() - (toTime(newest.createdDate) || 0) < ATTACH_OPP_FRESH_MIN * 60000;
            if (fresh && this.attachOpp === ao) {
                this.attachOpp = {
                    ...ao,
                    step: 'files',
                    opportunityId: newest.recordId,
                    opportunityName: newest.name || '',
                    fileLinks: this.formFiles((x) => x.contactId === ao.contactId)
                };
            } else {
                this.attachOpp = null;
            }
            this.load(true);
        } else if (st === 'ERROR') {
            this.message = 'The Contact: New Opportunity flow hit an error.';
        }
    }

    handleAttachOppUpload(e) {
        const files = (e.detail && e.detail.files) || [];
        if (!this.attachOpp) return;
        this.attachOpp = { ...this.attachOpp, uploaded: this.attachOpp.uploaded.concat(files.map((f) => f.name)) };
    }

    get attachOppHasUploads() {
        return !!this.attachOpp && this.attachOpp.uploaded.length > 0;
    }

    get attachOppUploadsText() {
        return this.attachOpp ? this.attachOpp.uploaded.join(', ') : '';
    }

    /** × or Done: closes the window; a Files step re-reads the open opportunities so the new one shows. */
    closeAttachOpp() {
        const ao = this.attachOpp;
        this.attachOpp = null;
        const r = ao && ao.step === 'files' ? this.rows.find((x) => x.id === ao.id) : null;
        if (r) this.loadContactOpps(r);
    }

    /** Tells Lightning Data Service the Lead/Contact changed so the record-edit-form fields reload. */
    async refreshLeadForm(recordId) {
        if (!recordId) return;
        try {
            await notifyRecordUpdateAvailable([{ recordId }]);
        } catch {
            // non-fatal: the form shows fresh values on next selection
        }
    }

    /** Log a call (canvas aabc, #96E): an outcome button only selects; Save logs it. */
    pickCallOutcome(e) {
        this.callOutcome = e.currentTarget.dataset.key || '';
    }

    async saveLogCall() {
        const a = this.active;
        const outcome = this.callOutcome;
        if (!a || !outcome) return;
        const notes = (this.callNotes || '').trim();
        await this.run(async () => {
            await logCallApex({ submissionId: a.id, outcome, comments: notes || null });
            this.loggingCall = false;
            this.callOutcome = '';
            this.callNotes = '';
            this.dispatchEvent(
                new ShowToastEvent({
                    title: 'LDR Inbox',
                    message: 'Logged: ' + outcome + (notes ? ' with comments' : '') + ' — created as a Task on the ' + a.recordObject + ', shown in Activity History below.',
                    variant: 'success'
                })
            );
            this.loadTimeline(a);
        });
    }

    /** Runs a write, then reloads the queue. Shows errors as a toast. Resolves true if the write worked. */
    async run(fn) {
        this.busy = true;
        this.message = undefined;
        let ok = false;
        try {
            await fn();
            // Saved: the forms rebuild from the new values and the draft resets after the reload.
            this._resetAfterLoad = true;
            this.formNonce += 1;
            this.preBase = {};
            this.autoFilled = {};
            ok = true;
        } catch (e) {
            this.dispatchEvent(new ShowToastEvent({ title: 'LDR Inbox', message: errorText(e), variant: 'error' }));
        } finally {
            this.busy = false;
            await this.load(true);
            this.loadUncontacted();
        }
        return ok;
    }
}
