/**
 * Estimate tab price table (canvas #100 / #111). The 60 ranges the nanawall.com instant estimator writes to
 * Website_Instant_Estimate__c.Estimate_Amount__c per Frame_Type__c x Frame_Width__c x Frame_Height__c, current since
 * 2026-06-26 (read-only production SOQL, 2026-10-15; copied unchanged from p3Pricing() in Aqil's canvas). Width
 * "Over 18'" or height "Under 7'" / "Over 9'" = Custom (the website writes "Custom" for those). When the website's
 * prices change, update this table and deploy.
 */
export const PRICES = {
    "Aluminum": {
        "6-9'": {
            "7'": "$8,400-$13,800",
            "7' 6\"": "$8,700-$14,200",
            "8'": "$9,300-$15,000",
            "8' 6\"": "$9,600-$16,100",
            "9'": "$10,900-$17,100"
        },
        "9-12'": {
            "7'": "$14,000-$18,000",
            "7' 6\"": "$14,500-$18,600",
            "8'": "$15,400-$19,700",
            "8' 6\"": "$15,800-$21,000",
            "9'": "$15,800-$22,400"
        },
        "12-15'": {
            "7'": "$16,800-$22,200",
            "7' 6\"": "$17,400-$22,900",
            "8'": "$18,600-$24,300",
            "8' 6\"": "$19,200-$26,000",
            "9'": "$20,700-$27,700"
        },
        "15-18'": {
            "7'": "$22,500-$26,400",
            "7' 6\"": "$23,200-$27,300",
            "8'": "$24,700-$28,900",
            "8' 6\"": "$25,400-$31,000",
            "9'": "$25,700-$33,000"
        }
    },
    "Aluminum Clad": {
        "6-9'": {
            "7'": "$10,200-$13,900",
            "7' 6\"": "$10,500-$14,400",
            "8'": "$11,200-$15,300",
            "8' 6\"": "$11,900-$16,300",
            "9'": "$12,600-$17,300"
        },
        "9-12'": {
            "7'": "$14,700-$18,200",
            "7' 6\"": "$15,200-$18,800",
            "8'": "$16,100-$20,000",
            "8' 6\"": "$17,200-$21,300",
            "9'": "$18,200-$22,700"
        },
        "12-15'": {
            "7'": "$19,200-$22,500",
            "7' 6\"": "$19,900-$23,200",
            "8'": "$21,100-$24,700",
            "8' 6\"": "$22,500-$26,400",
            "9'": "$23,900-$28,000"
        },
        "15-18'": {
            "7'": "$23,700-$26,700",
            "7' 6\"": "$24,500-$27,700",
            "8'": "$26,100-$29,400",
            "8' 6\"": "$27,800-$31,400",
            "9'": "$29,600-$33,400"
        }
    },
    "Wood": {
        "6-9'": {
            "7'": "$9,100-$12,500",
            "7' 6\"": "$9,400-$12,800",
            "8'": "$10,000-$13,600",
            "8' 6\"": "$10,600-$14,600",
            "9'": "$11,300-$15,500"
        },
        "9-12'": {
            "7'": "$13,100-$16,300",
            "7' 6\"": "$13,500-$16,800",
            "8'": "$14,400-$17,800",
            "8' 6\"": "$15,400-$19,100",
            "9'": "$16,400-$20,300"
        },
        "12-15'": {
            "7'": "$17,200-$20,000",
            "7' 6\"": "$17,700-$20,700",
            "8'": "$18,800-$22,000",
            "8' 6\"": "$20,100-$23,600",
            "9'": "$21,400-$25,100"
        },
        "15-18'": {
            "7'": "$21,200-$23,800",
            "7' 6\"": "$21,800-$24,600",
            "8'": "$23,200-$26,200",
            "8' 6\"": "$24,900-$28,100",
            "9'": "$26,500-$29,900"
        }
    }
};

export const FRAMES = ['Aluminum', 'Aluminum Clad', 'Wood'];
export const WIDTHS = ["6-9'", "9-12'", "12-15'", "15-18'", "Over 18'"];
export const HEIGHTS = ["Under 7'", "7'", "7' 6\"", "8'", "8' 6\"", "9'", "Over 9'"];
/** Widths / heights that have a price (the All sizes table). */
export const GRID_WIDTHS = WIDTHS.slice(0, 4);
export const GRID_HEIGHTS = HEIGHTS.slice(1, 6);

/** True when the estimator doesn't price this size (shown as "Custom"). */
export function isCustom(width, height) {
    return width === "Over 18'" || height === "Under 7'" || height === "Over 9'";
}

/** The price range for a frame / width / height, or '' when it is Custom or not picked yet. */
export function priceFor(frame, width, height) {
    if (!frame || !width || !height || isCustom(width, height)) return '';
    return ((PRICES[frame] || {})[width] || {})[height] || '';
}
