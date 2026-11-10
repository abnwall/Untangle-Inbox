import { LightningElement } from 'lwc';

/**
 * Lead Views tab (canvas #109-113; Aqil Bassa and Aziz Nana): Aqil's saved Lead list views and reports, in his order,
 * two panels per row. List views are live through lightning/uiListsApi; reports run through Apex (getReportRows).
 * The views and reports must be visible to whoever opens the tab (Aqil's "AB - ..." views and private-folder
 * reports need sharing with Aziz).
 */
const VIEWS = [
    { key: 'v1', kind: 'listview', title: 'AB - LDR Incomplete Leads (New)', listViewApiName: 'AB_All_LDR_Incomplete_Leads' },
    { key: 'v2', kind: 'listview', title: 'AB - LDR Incomplete Leads (Working)', listViewApiName: 'AB_LDR_Incomplete_Leads_Working' },
    { key: 'v3', kind: 'listview', title: 'AB - All LDR Working Leads w/ Outbound', listViewApiName: 'All_LDR_Working_Leads_w_Outbound' },
    { key: 'v4', kind: 'listview', title: 'AB - LDR - New Leads 2', listViewApiName: 'AB_LDR_New_Leads_21' },
    { key: 'r1', kind: 'report', title: '6S Leads - Additional Responses', reportId: '00OPY00000M9HMj2AN' },
    { key: 'r2', kind: 'report', title: '6S Contacts - Additional Responses', reportId: '00OPY00000M99CH2AZ' },
    { key: 'r3', kind: 'report', title: 'Ashley Non-QHR Responses', reportId: '00OPY00000Nt22L2AR' }
];

export default class LdrLeadViews extends LightningElement {
    get views() {
        return VIEWS;
    }
}
