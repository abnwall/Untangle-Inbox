import { LightningElement, api } from 'lwc';
import savePostQuote from '@salesforce/apex/LdrInboxController.savePostQuote';
import markPostQuoteReply from '@salesforce/apex/LdrInboxController.markPostQuoteReply';

/**
 * Post Quote reply page (canvas a111, #139-#142): one 6sense post-quote reply (Contact + project), shown by ldrInbox
 * beside its Post Quote cards. Project and Opportunity each save on their own (user mode); "Action taken" tags the
 * latest email's Comments; the FJTR card copies the rep email. After any write it fires "postquotechanged" so the
 * inbox reloads the replies (counts, cards, Finished / All).
 */
const PROJ_FIELDS = { projStage: 'Stage__c', projReason: 'Reason_Project_Lost__c', projLostTo: 'Lost_to__c', projStageDetail: 'Stage_Detail__c' };
const OPP_FIELDS = { oppStage: 'StageName', oppStageDetail: 'StageDetail__c' };
const PROJ_KEYS = Object.keys(PROJ_FIELDS);
const OPP_KEYS = Object.keys(OPP_FIELDS);
const LOST = 'Project Lost';
const COMPETITOR = 'Competitor';
const DONE_TAGS = ['Updated', 'Escalated', 'FJTRSent', 'NoActionNeeded'];
const TAG_LABEL = { Updated: 'Updated', Escalated: 'Escalated', FJTRSent: 'FJTR Sent', NoActionNeeded: 'No Action Needed' };
const DONE_DAYS = 7;
const TAB_NAME = { postquote: 'Post Quote', finished: 'Finished', team: 'All' };
const TYPE_PILL = { Homeowner: 'homeowner', Contractor: 'contractor', Architect: 'architect', 'Business Owner': 'business' };

function errorText(e) {
    if (!e) return 'Unknown error';
    if (e.body && e.body.message) return e.body.message;
    if (Array.isArray(e.body) && e.body.length) return e.body.map((x) => x.message).join(', ');
    return e.message || String(e);
}

/** The person's own reply: cut the quoted thread ("On … wrote:", "From: …", "-----Original Message-----"). */
function trimReply(body) {
    const t = (body || '').replace(/\r/g, '');
    const cut = t.search(/\n\s*(On [^\n]{3,200}wrote:|From:\s|-{3,}\s*Original Message)/i);
    const mine = (cut > 0 ? t.slice(0, cut) : t)
        .split('\n')
        .map((l) => l.trim())
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    return mine || t.trim();
}

function fmt(v) {
    if (!v) return '';
    const d = new Date(v);
    return d.toLocaleDateString('en-US') + ' ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function rec(object, id) {
    return id ? '/lightning/r/' + object + '/' + id + '/view' : null;
}

function options(list, current) {
    return [''].concat(list || []).map((v) => ({ value: v, label: v || '--None--', selected: v === (current || '') }));
}

/** (xxx) xxx-xxxx when the number has 10 digits (after a leading 1); otherwise as entered (canvas #142). */
function formatPhone(p) {
    const dg = (p || '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
    return dg.length === 10 ? '(' + dg.slice(0, 3) + ') ' + dg.slice(3, 6) + '-' + dg.slice(6) : p || '';
}

function escHtml(t) {
    return String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * FJTR rows in the team template's order (FJTR.oft, canvas #141); the last row is the editable details. v6f8: the other
 * values can be typed over too (`edits`, by row id; never saved). A linked value keeps its link with the edited text (an
 * edited email becomes the mailto); an emptied one has no link.
 */
function fjtrRows(a, text, edits) {
    const base = window.location.origin + '/lightning/r/';
    const ed = edits || {};
    const H = (k, accent, dark) => ({
        key: 'h' + k,
        isHeader: true,
        k,
        accent: accent || '',
        hasAccent: !!accent,
        dark: !!dark,
        cls: 'pq-fjtr-h' + (dark ? ' pq-fjtr-h-dark' : '')
    });
    const R = (id, k, v, href, solid) => {
        const edited = Object.prototype.hasOwnProperty.call(ed, id);
        const val = edited ? ed[id] : v || '';
        const link = href && href.startsWith('mailto:') ? (val.trim() ? 'mailto:' + val.trim() : '') : href || '';
        const hasHref = !!(link && val.trim());
        return {
            key: 'r' + k,
            id,
            isRow: true,
            k,
            v: val,
            href: link,
            hasHref,
            solid: !!solid,
            cls: 'pq-fjtr-row pq-fjtr-row-edit' + (solid ? ' pq-fjtr-row-solid' : ''),
            inCls: 'pq-fjtr-in' + (hasHref ? ' pq-fjtr-in-link' : '')
        };
    };
    return [
        H('NanaWall – FJTR -', ' THIS IS AN EXISTING OPPORTUNITY', true),
        H('Contact Information:'),
        R('contact', 'Contact', a.name, a.contactId ? base + 'Contact/' + a.contactId + '/view' : ''),
        R('email', 'Email', a.email, a.email ? 'mailto:' + a.email : ''),
        R('phone', 'Phone', '# ' + formatPhone(a.phone), '', true),
        H('Project'),
        R('project', 'Name', a.projectName || '[Project Name]', a.projectId ? base + 'Project__c/' + a.projectId + '/view' : ''),
        R('attach', 'Additional Attachments', 'N/A', '', true),
        H('Details'),
        { key: 'edit', isEdit: true, k: 'Questions/Comments/Concerns', v: (text || '').trim() || '[Insert details here]' }
    ];
}

/** The FJTR subject line; v6f8: can be typed over (edits.subject). */
function fjtrSubjectFor(a, edits) {
    return edits && Object.prototype.hasOwnProperty.call(edits, 'subject') ? edits.subject : 'FJTR | NanaWall | ' + (a.projectName || '[Project Name]');
}

/** Outlook HTML with the template's own colours; no spacer paragraphs around the table (canvas #142). */
function fjtrHtml(rows) {
    const td = 'padding:0 0 0 3pt; font-size:11pt; font-family:Aptos, Calibri, Arial, sans-serif;';
    const cell = (border, inner) => '<tr><td style="' + td + 'width:5in; ' + border + '">' + inner + '</td></tr>';
    const body = rows
        .map((r) => {
            if (r.isHeader && r.dark) {
                return cell('background:#538135; border-bottom:1px solid black;',
                    '<b><span style="font-size:13pt; color:white;">' + escHtml(r.k) + '</span><span style="font-size:13pt; color:#FFC000;">' + escHtml(r.accent) + '</span></b>');
            }
            if (r.isHeader) {
                return cell('background:#A8D08D; border-bottom:1px solid black;', '<b><span style="font-size:12pt; color:black;">' + escHtml(r.k) + '</span></b>');
            }
            if (r.isEdit) {
                return cell('border-bottom:1px dotted black;', '<b>' + escHtml(r.k) + '</b>:&nbsp;<br>' + escHtml(r.v).replace(/\n/g, '<br>'));
            }
            const v = r.hasHref
                ? '<a href="' + escHtml(r.href) + '" style="color:#00798F; text-decoration:underline;">' + escHtml(r.v) + '</a>'
                : escHtml(r.v);
            return cell('border-bottom:1px ' + (r.solid ? 'solid' : 'dotted') + ' black;', '<b>' + escHtml(r.k) + '</b>: ' + v);
        })
        .join('');
    const P = 'margin:0; font-family:Aptos, Calibri, Arial, sans-serif; font-size:11pt;';
    return '<p style="' + P + '">Hi Team,</p><table style="border-collapse:collapse; width:480px; margin:0;">' + body + '</table><p style="' + P + '">Best,</p>';
}

function fjtrText(rows) {
    return 'Hi Team,\n' + rows.map((r) => (r.isHeader ? r.k + r.accent : r.k + ':' + (r.isEdit ? '\n' : ' ') + r.v)).join('\n').trim() + '\nBest,';
}

export default class LdrPostQuote extends LightningElement {
    /** { proj, reason, lostTo, opp } picklist values from getPostQuote. */
    @api picklists = { proj: [], reason: [], lostTo: [], opp: [] };
    /** Whose Finished the reply counts in (the inbox viewer; admins' "View as" too). */
    @api viewerId;
    /** The inbox tab the list is on (canvas #143B: "Go to <Tab> Tab" when the reply's tab differs). */
    @api listTab;

    _row = null;
    drafts = {}; // reply key -> unsaved Project / Opportunity values
    fjtr = {}; // reply key -> edited FJTR Questions/Comments/Concerns
    fjtrEdits = {}; // v6f8: reply key -> { FJTR row id / 'subject': typed-over value } (kept while open, never saved)
    busy = false;
    message = '';

    /** The selected reply, mapped by ldrInbox (key, emails newest first, latest, others, rep, done, …). */
    @api
    get row() {
        return this._row;
    }
    set row(v) {
        if (!v || !this._row || v.key !== this._row.key) this.message = '';
        this._row = v;
    }

    get hasRow() {
        return !!this._row;
    }

    get cur() {
        const a = this._row;
        return a ? { ...a, ...(this.drafts[a.key] || {}) } : {};
    }

    changedOf(keys) {
        const a = this._row;
        const d = (a && this.drafts[a.key]) || {};
        return a ? keys.filter((k) => d[k] !== undefined && (d[k] || '') !== (a[k] || '')) : [];
    }

    get projDirty() {
        return this.changedOf(PROJ_KEYS).length > 0;
    }

    get projClean() {
        return !this.projDirty || this.busy;
    }

    get oppDirty() {
        return this.changedOf(OPP_KEYS).length > 0;
    }

    get oppClean() {
        return !this.oppDirty || this.busy;
    }

    get fjtrValue() {
        const a = this._row;
        if (!a) return '';
        return this.fjtr[a.key] !== undefined ? this.fjtr[a.key] : trimReply((a.latest || {}).body);
    }

    /** v5.6b: the alert group (above the Action taken line) also holds the save message, so the boxes stay put. */
    get showAlerts() {
        return !!this.message || this.showNoCoordAlert || this.showDoneAlert;
    }

    // v5.7: alerts closed with ×, "<reply key>:<alert>" -> true (kept while the page is open)
    dismissed = {};

    alertOpen(key) {
        return !!this._row && !this.dismissed[this._row.key + ':' + key];
    }

    get showNoCoordAlert() {
        return !!this.d.noCoordinator && this.alertOpen('noCoord');
    }

    get showDoneAlert() {
        return !!this.d.isDone && this.alertOpen('done');
    }

    dismissAlert(e) {
        const key = e.currentTarget.dataset.key;
        if (key === 'message') this.message = '';
        else if (this._row) this.dismissed = { ...this.dismissed, [this._row.key + ':' + key]: true };
    }

    /**
     * Page view model. The template reads it many times per render ({d.x}), so it is rebuilt only when the row, its
     * draft, its FJTR text, the picklists or the viewer change (all are replaced, never mutated).
     */
    get d() {
        const a = this._row;
        if (!a) return {};
        const draft = this.drafts[a.key];
        const text = this.fjtr[a.key];
        const edits = this.fjtrEdits[a.key];
        const c = this._dCache;
        if (c && c.a === a && c.draft === draft && c.text === text && c.edits === edits && c.picklists === this.picklists &&
            c.viewerId === this.viewerId && c.listTab === this.listTab) {
            return c.value;
        }
        const value = this.buildDetail(a);
        this._dCache = { a, draft, text, edits, picklists: this.picklists, viewerId: this.viewerId, listTab: this.listTab, value };
        return value;
    }

    buildDetail(a) {
        const c = this.cur;
        const pl = this.picklists || {};
        const latest = a.latest || {};
        const others = a.others || [];
        const reasonOn = c.projStage === LOST;
        const lostToOn = reasonOn && c.projReason === COMPETITOR;
        const phone = a.phone || '';
        const done = a.done;
        const edits = this.fjtrEdits[a.key];
        const rows = fjtrRows(a, this.fjtrValue, edits);
        // canvas #143B: the reply's own tab; a link to it when the list is on another tab
        const homeTab = done ? (a.coordinatorId === this.viewerId ? 'finished' : 'team') : 'postquote';
        const showGoTab = !!this.listTab && homeTab !== this.listTab;
        return {
            showGoTab,
            goTabLabel: showGoTab ? 'Go to ' + TAB_NAME[homeTab] : '', // #154: no "Tab" at the end
            goTabKey: homeTab,
            name: a.name,
            firstName: (a.name || '').split(' ')[0],
            email: a.email || '—',
            phone: formatPhone(phone) || '—',
            telHref: phone ? 'tel:' + phone.replace(/[^0-9+]/g, '') : null,
            mailHref: a.email ? 'mailto:' + a.email + '?subject=' + encodeURIComponent('Re: ' + (a.projectName || 'your NanaWall project')) : null,
            customerType: a.customerType,
            typePillCls: 'pq-type-pill pq-type-' + (TYPE_PILL[a.customerType] || 'unknown'),
            segKind: a.segKind,
            currentTab: done ? (a.coordinatorId === this.viewerId ? 'Finished' : 'All') : 'Post Quote',
            accountName: a.accountName || '—',
            accountHref: rec('Account', a.accountId),
            location: [[a.city, a.state].filter(Boolean).join(', '), a.zip].filter(Boolean).join(' ') || 'No address on Contact',
            rep: a.rep || '—',
            hasGeneralApp: !!a.generalApp,
            generalApp: a.generalApp || '—',
            hasSpecificApp: !!a.specificApp,
            specificApp: a.specificApp || '',
            // header line 3 (#157 B / #159): "General · Specific" as text; no separator when General Application is blank
            specSep: a.generalApp ? ' · ' : '',
            isSplit: !!a.isSplit,
            splitLabel: a.isSplit ? 'Split Territory: Project in ' + a.projectOwnerShown + '’s area' : '',
            // #161: the banners sit between header line 2 and the Action taken line; the group renders only when one shows
            // (showAlerts)
            noCoordinator: !a.coordinatorId,
            contactHref: rec('Contact', a.contactId),
            oppHref: rec('Opportunity', a.oppId),
            projectHref: rec('Project__c', a.projectId),
            emailHref: rec('Task', latest.taskId),
            repliedAt: fmt(latest.at),
            comments: trimReply(latest.body),
            others: others.map((o) => ({ key: o.taskId, at: fmt(o.at), subject: o.subject, reply: trimReply(o.body), href: rec('Task', o.taskId) })),
            noOthers: others.length === 0,
            // Action taken (canvas #140 / #141)
            isDone: !!done,
            doneLine: done
                ? 'Marked ' + (TAG_LABEL[done.tag] || done.tag) + ' ' + fmt(done.at) + (done.by ? ' by ' + done.by : '') + ' · #' + done.tag +
                  ' added to the email’s Comments. In Finished / All until ' + fmt(new Date(new Date(done.at).getTime() + DONE_DAYS * 86400000)) + '.'
                : '',
            doneBtns: DONE_TAGS.map((tg) => {
                const on = !!(done && done.tag === tg);
                return {
                    tag: tg,
                    label: TAG_LABEL[tg],
                    cls: 'pq-done-btn' + (on ? ' pq-done-btn-on' : ''),
                    on: on ? '1' : '',
                    pressed: on ? 'true' : 'false',
                    title: on ? 'Click again to undo' : 'Add #' + tg + ' to the email’s Comments: done, moves to Finished'
                };
            }),
            // Project Details
            projectName: a.projectName || '—',
            hasProject: !!a.projectId,
            noProject: !a.projectId,
            projStageOptions: options(pl.proj, c.projStage),
            reasonOn,
            reasonOptions: options(pl.reason, c.projReason),
            lostToOn,
            lostToOptions: options(pl.lostTo, c.projLostTo),
            projStageDetail: c.projStageDetail || '',
            projLastMod: (a.projLMBy || '—') + (a.projLMAt ? ' · ' + fmt(a.projLMAt) : ''),
            // Opportunity Details
            oppName: a.oppName || '—',
            hasOpp: !!a.oppId,
            noOpp: !a.oppId,
            oppStageOptions: options(pl.opp, c.oppStage),
            oppStageDetail: c.oppStageDetail || '',
            oppLastMod: (a.oppLMBy || '—') + (a.oppLMAt ? ' · ' + fmt(a.oppLMAt) : ''),
            // FJTR (canvas #141)
            fjtrSubject: fjtrSubjectFor(a, edits),
            fjtrRows: rows.filter((r) => !r.isEdit),
            fjtrEdited: (!!edits && Object.keys(edits).length > 0) || this.fjtr[a.key] !== undefined // v6f8: shows Reset
        };
    }

    /** "Go to <Tab> Tab": the inbox switches the list to the reply's tab (and the Post Quote filter that lists it). */
    goToTab() {
        const a = this._row;
        if (!a) return;
        const pqFilter = a.coordinatorId === this.viewerId ? 'Mine' : a.coordinatorId ? 'All LDRs' : 'No Project Coordinator';
        this.dispatchEvent(new CustomEvent('gototab', { detail: { tab: this.d.goTabKey, key: a.key, pqFilter } }));
    }

    edit(patch) {
        const a = this._row;
        if (!a) return;
        this.drafts = { ...this.drafts, [a.key]: { ...(this.drafts[a.key] || {}), ...patch } };
    }

    clearDraft(keys) {
        const a = this._row;
        if (!a) return;
        const d = { ...(this.drafts[a.key] || {}) };
        keys.forEach((k) => delete d[k]);
        this.drafts = { ...this.drafts, [a.key]: d };
    }

    // Stage -> Reason Project Lost -> Lost To: changing a parent clears children that no longer apply.
    setProjStage(e) {
        const v = e.target.value;
        const p = { projStage: v };
        if (v !== LOST) {
            p.projReason = '';
            p.projLostTo = '';
        }
        this.edit(p);
    }

    setReason(e) {
        const v = e.target.value;
        const p = { projReason: v };
        if (v !== COMPETITOR) p.projLostTo = '';
        this.edit(p);
    }

    setLostTo(e) {
        this.edit({ projLostTo: e.target.value });
    }

    setProjDetail(e) {
        this.edit({ projStageDetail: e.target.value });
    }

    setOppStage(e) {
        this.edit({ oppStage: e.target.value });
    }

    setOppDetail(e) {
        this.edit({ oppStageDetail: e.target.value });
    }

    cancelProj() {
        this.clearDraft(PROJ_KEYS);
        this.message = '';
    }

    cancelOpp() {
        this.clearDraft(OPP_KEYS);
        this.message = '';
    }

    saveProj() {
        return this.saveSide('Project', PROJ_KEYS, PROJ_FIELDS);
    }

    saveOpp() {
        return this.saveSide('Opportunity', OPP_KEYS, OPP_FIELDS);
    }

    /** Saves one box only (canvas #140); the other box's unsaved edits stay. */
    async saveSide(label, keys, map) {
        const a = this._row;
        const changed = this.changedOf(keys);
        if (!a || !changed.length) return;
        const d = this.drafts[a.key] || {};
        const fields = {};
        changed.forEach((k) => {
            fields[map[k]] = d[k] || '';
        });
        this.busy = true;
        this.message = '';
        try {
            await savePostQuote(
                label === 'Project'
                    ? { projectId: a.projectId, oppId: null, projectFields: fields, oppFields: null }
                    : { projectId: null, oppId: a.oppId, projectFields: null, oppFields: fields }
            );
            this.clearDraft(keys);
            this.message = 'Saved ' + label + '.';
            this.dispatchEvent(new CustomEvent('postquotechanged'));
        } catch (e) {
            this.message = 'Could not save: ' + errorText(e);
        } finally {
            this.busy = false;
        }
    }

    /** Action taken: tag the latest email's Comments (done -> Finished / All for 7 days); the lit button undoes it. */
    async markDone(e) {
        const a = this._row;
        const latest = (a && a.latest) || {};
        const tag = e.currentTarget.dataset.tag;
        const undo = !!e.currentTarget.dataset.on;
        if (!latest.taskId || !tag) return;
        this.busy = true;
        this.message = '';
        try {
            await markPostQuoteReply({ taskId: latest.taskId, tag, undo });
            this.message = undo
                ? 'Undone: #' + tag + ' removed from the email’s Comments. Back in Post Quote.'
                : 'Marked ' + TAG_LABEL[tag] + ': #' + tag + ' added to the end of the email’s Comments. Moved to Finished and All for ' + DONE_DAYS + ' days.';
            this.dispatchEvent(new CustomEvent('postquotechanged'));
        } catch (err) {
            this.message = 'Could not mark the reply: ' + errorText(err);
        } finally {
            this.busy = false;
        }
    }

    // ---------------------------------------------------------------- FJTR (canvas #141 / #142)

    /**
     * A native <textarea> ignores a value={…} binding (compiler warning LWC1057), so the FJTR box opened empty instead of
     * with the reply. Its text is in data-text and filled here, only when it differs (typing doesn't move the caret).
     */
    renderedCallback() {
        const ta = this.template.querySelector('textarea.pq-fjtr-text');
        if (ta && ta.value !== (ta.dataset.text || '')) ta.value = ta.dataset.text || '';
    }

    setFjtrText(e) {
        const a = this._row;
        if (a) this.fjtr = { ...this.fjtr, [a.key]: e.target.value };
    }

    /** v6f8: a FJTR value or the subject typed over (kept per reply while the page is open; the copies use it). */
    setFjtrField(e) {
        const a = this._row;
        const id = e.target.dataset.id;
        if (!a || !id) return;
        this.fjtrEdits = { ...this.fjtrEdits, [a.key]: { ...(this.fjtrEdits[a.key] || {}), [id]: e.target.value } };
    }

    /** v6f8: back to the Salesforce values and their latest reply. */
    resetFjtr() {
        const a = this._row;
        if (!a) return;
        const edits = { ...this.fjtrEdits };
        delete edits[a.key];
        const text = { ...this.fjtr };
        delete text[a.key];
        this.fjtrEdits = edits;
        this.fjtr = text;
    }

    copyFjtr() {
        const a = this._row;
        if (!a) return;
        const rows = fjtrRows(a, this.fjtrValue, this.fjtrEdits[a.key]);
        this.copyRich(fjtrHtml(rows), fjtrText(rows)).then((ok) => {
            this.message = ok
                ? 'FJTR copied with links. Paste it into the email to the rep.'
                : 'Couldn’t copy automatically here; select the FJTR box and copy it.';
        });
    }

    copyFjtrSubject() {
        const a = this._row;
        if (!a) return;
        const subj = fjtrSubjectFor(a, this.fjtrEdits[a.key]);
        this.copyRich(escHtml(subj), subj).then((ok) => {
            this.message = ok ? 'Subject copied: ' + subj : 'Couldn’t copy automatically here; the subject is ' + subj;
        });
    }

    /**
     * Copies HTML + plain text (same approach as the inbox's Copy FETR). Tries the async Clipboard API; if Lightning
     * blocks it, selects a hidden copy of the HTML inside this component and uses execCommand('copy'). Resolves true/false.
     */
    copyRich(html, text) {
        const fallback = () => {
            let ok = false;
            try {
                const host = this.template.querySelector('.pq-copy-host');
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
}
