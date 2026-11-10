/* LDR Inbox (v6f1): spacing inside Salesforce's base components (lightning-combobox, lightning-input, lightning-input-field,
   lightning-input-address). ldrInbox.css can't reach inside them, so ldrInbox.js loads this file globally with loadStyle.
   Every rule starts at .ldr-shell (the inbox's outer box), so nothing outside the inbox changes.
   It relies on Lightning rendering these components with synthetic shadow DOM, as it does today, and on their SLDS class
   names. Salesforce doesn't support styling inside its components: if it changes their markup or switches them to native
   shadow DOM, these rules stop matching and the fields fall back to Salesforce's own spacing (nothing breaks). */

/* LDR Fields: Project Coordinator, Lead Funnel Timestamp, Status, Lead Funnel Outcome labels */
.ldr-shell .ldr-card.ldr-fields > .ldr-pair .slds-form-element__label {
    padding-top: 1px;
    margin-bottom: 1px;
    margin-right: 6px;
}
/* v6f7: "Lead Funnel Timestamp" never wraps (ldrInbox.css keeps LDR Fields wide enough for it at a 14px minimum font;
   this keeps it on one line with a wider fallback font too) */
.ldr-shell .ldr-nowrap-label .slds-form-element__label {
    white-space: nowrap;
}

/* Project Details popup: labels tight to their fields, 4px between stacked fields */
.ldr-shell .ldr-dialog-pd .slds-form-element__label {
    padding-top: 0;
    margin-bottom: 0;
    margin-right: 0;
}
.ldr-shell .ldr-dialog-pd .slds-form-element_stacked {
    margin-bottom: 4px;
}
/* v6g5: Project Type with nothing under it, Industry | Application 2px, Construction Classification | Timeline nothing
   (their 6px / 8px row spacing is in ldrInbox.css) */
.ldr-shell .ldr-dialog-pd lightning-input-field[data-field="Type_of_record__c"] .slds-form-element_stacked {
    margin-bottom: 0;
}
.ldr-shell .ldr-dialog-pd .ldr-pd-approw .slds-form-element_stacked {
    margin-bottom: 2px;
}
.ldr-shell .ldr-dialog-pd .ldr-pd-classrow .slds-form-element_stacked {
    margin-bottom: 0;
}
/* Project Site address: City | State and Zip rows without their -4px side margins, so they line up with Search and
   Country (all 4px in from the popup's edges, like the other fields); v6g5: nothing under them (was 3.5px) */
.ldr-shell .ldr-dialog-pd .ldr-project-address .slds-form-element__row {
    margin-left: 0;
    margin-right: 0;
    margin-bottom: 0;
}
/* "Project Site Address" heading 4px in, like the other labels */
.ldr-shell .ldr-dialog-pd .ldr-project-address .slds-form-element__legend {
    padding-left: 4px;
}
/* nothing under Search project address (was 8px; 1px before v6g5) */
.ldr-shell .ldr-dialog-pd .ldr-project-address .slds-form-element__control > .slds-form-element:first-child {
    margin-bottom: 0;
}
