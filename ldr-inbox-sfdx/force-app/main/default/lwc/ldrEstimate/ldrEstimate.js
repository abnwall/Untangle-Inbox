import { LightningElement } from 'lwc';
import FRAME_IMAGES from '@salesforce/resourceUrl/LDR_EstimateFrames';
import { PRICES, FRAMES, WIDTHS, HEIGHTS, GRID_WIDTHS, GRID_HEIGHTS, isCustom, priceFor } from './estimatePrices';

const FRAME_FILE = { Aluminum: 'frame-aluminum.jpg', 'Aluminum Clad': 'frame-clad.jpg', Wood: 'frame-wood.jpg' };

/**
 * Estimate tab (canvas #100 content, #101 layout, released to every LDR in #111): rough price range for a standard
 * NanaWall opening, the same ranges as the website's instant estimator (estimatePrices.js). No Apex, nothing saved.
 */
export default class LdrEstimate extends LightningElement {
    frame = 'Aluminum';
    width = '';
    height = '';
    copied = false;
    copyFailed = false;

    get price() {
        return priceFor(this.frame, this.width, this.height);
    }

    get picked() {
        return !!(this.width && this.height);
    }

    get hasPrice() {
        return !!this.price;
    }

    get custom() {
        return this.picked && isCustom(this.width, this.height);
    }

    get frames() {
        return FRAMES.map((f) => ({
            key: f,
            label: f,
            img: FRAME_IMAGES + '/' + FRAME_FILE[f],
            cls: 'est-frame' + (f === this.frame ? ' est-frame-on' : '')
        }));
    }

    get widthButtons() {
        return WIDTHS.map((w) => ({ key: w, label: w, cls: 'est-btn' + (w === this.width ? ' est-btn-on' : '') }));
    }

    get heightButtons() {
        return HEIGHTS.map((h) => ({ key: h, label: h, cls: 'est-btn' + (h === this.height ? ' est-btn-on' : '') }));
    }

    get priceBig() {
        return this.price || (this.picked ? 'Custom' : '—');
    }

    get resultCls() {
        return 'est-card est-result ' + (this.hasPrice ? 'est-result-priced' : this.picked ? 'est-result-custom' : 'est-result-empty');
    }

    get priceCls() {
        return 'est-price' + (this.picked ? '' : ' est-price-empty');
    }

    get summary() {
        if (!this.picked) return 'Pick a frame type, width and height.';
        return this.frame + ' · ' + this.width + ' wide × ' + this.height + ' tall' +
            (this.custom ? " · outside what the estimator prices (6-18' wide, 7-9' tall)" : '');
    }

    get sentence() {
        return this.price
            ? 'For an opening of ' + this.width + ' x ' + this.height + ' (' + this.frame + ' frame), the approximate cost would be ' + this.price + '.'
            : '';
    }

    get gridHeads() {
        return GRID_HEIGHTS.map((h) => ({ key: h, label: h, cls: 'est-th' + (h === this.height ? ' est-th-on' : '') }));
    }

    get grid() {
        const table = PRICES[this.frame] || {};
        return GRID_WIDTHS.map((w) => ({
            key: w,
            width: w,
            widthCls: 'est-td-w' + (w === this.width ? ' est-td-w-on' : ''),
            cells: GRID_HEIGHTS.map((h) => ({
                key: w + '|' + h,
                width: w,
                height: h,
                text: (table[w] || {})[h] || '',
                title: this.frame + ' · ' + w + ' × ' + h,
                cls: 'est-cell' + (w === this.width && h === this.height ? ' est-cell-on' : '')
            }))
        }));
    }

    resetCopy() {
        this.copied = false;
        this.copyFailed = false;
    }

    pickFrame(e) {
        this.frame = e.currentTarget.dataset.key;
        this.resetCopy();
    }

    pickWidth(e) {
        this.width = e.currentTarget.dataset.key;
        this.resetCopy();
    }

    pickHeight(e) {
        this.height = e.currentTarget.dataset.key;
        this.resetCopy();
    }

    pickCell(e) {
        this.width = e.currentTarget.dataset.width;
        this.height = e.currentTarget.dataset.height;
        this.resetCopy();
    }

    /** Copy for email: clipboard API (works under Lightning Web Security), else select a readonly textarea and copy. */
    copyForEmail() {
        const text = this.sentence;
        if (!text) return;
        const fallback = () => {
            let ok = false;
            try {
                const ta = this.template.querySelector('.est-copy-src');
                ta.value = text;
                ta.select();
                ok = document.execCommand('copy');
            } catch {
                ok = false;
            }
            this.copied = ok;
            this.copyFailed = !ok;
        };
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(text).then(
                    () => {
                        this.copied = true;
                        this.copyFailed = false;
                    },
                    fallback
                );
                return;
            }
        } catch {
            // fall back below
        }
        fallback();
    }
}
