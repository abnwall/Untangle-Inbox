import { LightningElement, api } from 'lwc';
import getKbmaxQuotes from '@salesforce/apex/LdrInboxController.getKbmaxQuotes';
import linkKbmaxQuotes from '@salesforce/apex/LdrInboxController.linkKbmaxQuotes';

const money = (v) => (v === null || v === undefined || v === '' ? '' : '$' + Math.round(Number(v)).toLocaleString('en-US'));
const day = (v) => (v ? new Date(v).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '');

/**
 * Files step of the Convert and Attach to Opportunity windows (Aqil, 2026-10-30): the person's KBMax web quotes from the
 * last year, each with a checkbox on its left. Checking one adds a KBMax Web Quote Junction to the new Opportunity right
 * away; a joined quote stays checked and can't be unchecked here. Shows nothing when there are no quotes.
 */
export default class LdrKbmaxLink extends LightningElement {
    @api leadId;
    @api contactId;
    @api opportunityId;

    quotes = [];
    error = '';
    working = {}; // quote Id -> link in progress

    connectedCallback() {
        this.load();
    }

    async load() {
        if (!this.leadId && !this.contactId) return;
        try {
            this.quotes = (await getKbmaxQuotes({ leadId: this.leadId || null, contactId: this.contactId || null, opportunityId: this.opportunityId || null })) || [];
        } catch (e) {
            this.error = (e && e.body && e.body.message) || 'Couldn’t read the KBMax web quotes.';
        }
    }

    get hasQuotes() {
        return this.quotes.length > 0;
    }

    get rows() {
        return this.quotes.map((q) => ({
            id: q.id,
            name: q.project || q.name || 'KBMax web quote',
            sub: [q.product, money(q.price), day(q.createdDate)].filter(Boolean).join(' · '),
            checked: !!q.linked,
            off: !!q.linked || !!this.working[q.id] || !this.opportunityId,
            status: q.linked ? 'Added' : this.working[q.id] ? 'Adding…' : ''
        }));
    }

    async handleCheck(e) {
        const id = e.target.dataset.id;
        if (!e.target.checked || !id || !this.opportunityId) return;
        this.working = { ...this.working, [id]: true };
        this.error = '';
        try {
            await linkKbmaxQuotes({ opportunityId: this.opportunityId, quoteIds: [id] });
            this.quotes = this.quotes.map((q) => (q.id === id ? { ...q, linked: true } : q));
        } catch (err) {
            e.target.checked = false;
            this.error = (err && err.body && err.body.message) || 'Couldn’t add the KBMax quote.';
        } finally {
            const w = { ...this.working };
            delete w[id];
            this.working = w;
        }
    }
}
