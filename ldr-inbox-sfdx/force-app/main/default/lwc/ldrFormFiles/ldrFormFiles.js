import { LightningElement, api } from 'lwc';

/**
 * #161: the form submission's files in the Convert and Attach to Opportunity windows. Each file gets a Download link
 * and a preview; nothing is attached automatically (Aqil, 2026-10-30: no Remote Site / Apex download).
 * files: [{ key, url, name, label, kind, isImage, isPdf }] (ldrInbox parseAttachments).
 */
export default class LdrFormFiles extends LightningElement {
    @api files = [];
    @api note = '';

    get hasFiles() {
        return Array.isArray(this.files) && this.files.length > 0;
    }
}
