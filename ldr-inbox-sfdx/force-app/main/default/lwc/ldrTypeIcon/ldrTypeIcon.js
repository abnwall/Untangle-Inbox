import { LightningElement, api } from 'lwc';

/**
 * Customer type icon (NanaWall brand artboard, canvas 2de1): Homeowner / Contractor / Architect / Business Owner as a
 * small line icon; other types as plain grey text when show-text is set. The parent sets the title for the tooltip.
 */
export default class LdrTypeIcon extends LightningElement {
    @api type;
    /** Show non-icon types (Unknown etc.) as grey text. */
    @api showText = false;

    get isHome() {
        return this.type === 'Homeowner';
    }
    get isContractor() {
        return this.type === 'Contractor';
    }
    get isArchitect() {
        return this.type === 'Architect';
    }
    get isBusiness() {
        return this.type === 'Business Owner';
    }
}
