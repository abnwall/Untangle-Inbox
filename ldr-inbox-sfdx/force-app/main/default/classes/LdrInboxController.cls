/**
 * LDR Inbox – server controller for the ldrInbox Lightning Web Component.
 *
 * Queue source: Form_Submission__c records linked to an unconverted Lead, or to a Contact
 *               (Lead__c blank, Contact__c set: the person already exists as a Contact).
 * Claim model:  Claimed_By__c (Lookup User) + ClaimedDate__c (Date/Time, #156; the old Date Claimed_Date__c is no longer
 *               written) on Form_Submission__c, Website_Instant_Estimate__c and KBMax_Web_Quote__c.
 *               Claim takes over Project_Coordinator__c and sets Lead_Funnel_Time_Stamp__c to today
 *               on the linked Lead or Contact. Release restores both from field history.
 *               Claim also claims the person's other unclaimed submissions (same Lead / Contact, or same
 *               email when nothing is linked). Reassign gives a claim back to the coordinator it replaced;
 *               Claim from a teammate takes over another LDR's claim (prototype 1791332457-946d).
 * Contacts:     the same LDR fields live on Contact (Lead_Funnel_Status__c instead of Lead.Status,
 *               Lead_Funnel_Outcome__c, Project_Coordinator__c, Lead_Funnel_Time_Stamp__c). Status Reason isn't edited
 *               (2026-10-21); the inbox flags Lead Funnel Outcome for Wrong profile / Disqualified but doesn't enforce it.
 *
 * Security: the class is `with sharing`, so record sharing is always enforced.
 * Reads run in system mode and then pass through Security.stripInaccessible, so a
 * field the user can't read is blanked (and reported in hiddenFields) instead of
 * failing the whole queue. Writes run in USER_MODE, so a user without edit access
 * gets a clear error.
 *
 * STATUS: see README.md (production candidate; Apex not yet compiled or tested end to end in an org).
 * Refactor log: REFACTOR_LOG.md.
 */
public with sharing class LdrInboxController {

    @TestVisible static final Integer DEFAULT_LOOKBACK_DAYS = 30;
    /** The team's time zone: Lead Funnel Timestamps, estimate windows and dashboard days are Pacific. */
    @TestVisible static final String PACIFIC_TZ = 'America/Los_Angeles';
    /** Queue cap per object, newest first (Aqil, 2026-10-27: 500 -> 1000; production had 727 forms in 30 days). */
    @TestVisible static final Integer MAX_ROWS = 1000;
    @TestVisible static final String CONFLICT_PREFIX = 'CONFLICT:';
    /**
     * Claim time (canvas #156): Date/Time on all three queue objects. Written on claim, claim from a teammate, assign,
     * reassign and junk; cleared on release / restore. Replaces the Date field Claimed_Date__c, which isn't written.
     */
    @TestVisible static final String CLAIMED_AT = 'ClaimedDate__c';
    /** Statuses still being worked; anything else takes a claimed submission off Mine / Team (filtered in the LWC). */
    @TestVisible static final Set<String> ACTIVE_STATUSES = new Set<String>{ 'New', 'Working' };
    /** Contact fields the LDR can edit besides status/reason/outcome (no Project Details on Contacts). */
    @TestVisible static final Set<String> CONTACT_EDIT_FIELDS = new Set<String>{
        'Project_Coordinator__c', 'Lead_Funnel_Time_Stamp__c', 'X6Sense_Option__c'
    };
    /** Submissions of this inquiry type (rep requests) are not LDR work and are excluded. */
    // Inquiry_Type__c = 'Representative' is the production value; "Rep Contact" is only a Type__c value (unused).
    @TestVisible static final Set<String> EXCLUDED_INQUIRIES = new Set<String>{ 'Representative' };
    /** Lead fields read by NW_CustomLeadConvertScreen that the LDR fills in before hand-off. */
    @TestVisible static final Set<String> PRE_CONVERSION_FIELDS = new Set<String>{
        'Project_Name__c', 'Type_of_record__c', 'Project_Application_Industry__c', 'Project_Application__c',
        'Project_Site_Street__c', 'Project_Site_City__c', 'Project_Site_Zip_Code__c', 'Project_Site_Country__c',
        'Project_Site_State__c', 'Project_Coordinator__c', 'Lead_Funnel_Time_Stamp__c', 'X6Sense_Option__c',
        // v5.6: Project Details popup
        'Project_Construction_Classification__c', 'Project_Timeline__c', 'Quote_Request__c', 'Reference_Opportunity__c'
    };
    /**
     * Claiming a Lead/Contact in one of these resets its status to New. Qualified/Disqualified are included
     * (prototype e091): Mine/Team only show New/Working, so a claimed Qualified lead would otherwise vanish from
     * every tab. The inbox warns before the claim; the LDR can set it back afterwards. A value that is no longer active in
     * the field's picklist (e.g. Contact "Inactive", Lead "Close - No Further Action") is reset too: isRetiredStatus.
     */
    @TestVisible static final Set<String> CLAIM_RESETS_STATUS = new Set<String>{
        'Nurture', 'Wrong profile', 'Unreachable', 'Bounced', 'Qualified', 'Disqualified'
    };
    /** Lead History rows hidden from the timeline (geocoding / system noise). */
    @TestVisible static final Set<String> HISTORY_NOISE_FIELDS = new Set<String>{
        'Latitude', 'Longitude', 'GeocodeAccuracy', 'CountryCode', 'StateCode',
        'MailingLatitude', 'MailingLongitude', 'MailingGeocodeAccuracy', 'MailingCountryCode', 'MailingStateCode',
        'OtherLatitude', 'OtherLongitude', 'OtherGeocodeAccuracy'
    };
    @TestVisible static final Set<String> HISTORY_NOISE_USERS = new Set<String>{ 'Data.com Clean' };
    /**
     * Admins (Aqil Bassa, Aziz Nana): get "View as" in the inbox and may edit an UNCLAIMED submission's LDR fields
     * without claiming it. Hard-coded per the 2026-10-06 notes; a Custom Permission would be the cleaner long-term
     * option (needs an admin to create and assign it).
     */
    @TestVisible static Set<Id> adminUserIds = new Set<Id>{ '005A0000008OTqWIAW', '005A0000000MOIwIAO' };
    /** Lead / Contact / claim fields shared by the form-submission and instant-estimate queue queries. */
    @TestVisible static final String LINKED_RECORD_FIELDS =
        'Contact__c, Contact__r.Name, Contact__r.Email, Contact__r.Phone, Contact__r.Account.Name, Contact__r.Owner.Name, '
        + 'Contact__r.MailingCity, Contact__r.MailingState, Contact__r.MailingPostalCode, '
        + 'Contact__r.AccountId, Contact__r.CreatedDate, Contact__r.MailingLatitude, '
        + 'Contact__r.MailingLongitude, Lead__r.Latitude, Lead__r.Longitude, '
        + 'Contact__r.Project_Coordinator__c, Contact__r.Project_Coordinator__r.Name, '
        + 'Contact__r.Lead_Funnel_Time_Stamp__c, Contact__r.Lead_Funnel_Status__c, '
        + 'Contact__r.Lead_Funnel_Outcome__c, Claimed_By__c, Claimed_By__r.Name, ClaimedDate__c, Lead__c, '
        + 'Lead__r.Name, Lead__r.Email, Lead__r.Type__c, Lead__r.Status, Lead__r.IsConverted, '
        + 'Lead__r.ConvertedDate, Lead__r.Lead_Funnel_Outcome__c, '
        + 'Lead__r.LDR_Project_Name__c, Lead__r.LDR_Notes__c, Lead__r.Project_Coordinator__c, '
        + 'Lead__r.Project_Coordinator__r.Name, Lead__r.Owner.Name, Lead__r.Windfall_Lead_Grade__c, '
        + 'Lead__r.Outreach_Current_Sequence_Status__c, Lead__r.Project_Name__c, '
        + 'Lead__r.Territory__c, Contact__r.Territory__c, Lead__r.Type_of_record__c, Lead__r.Project_Application_Industry__c, '
        + 'Lead__r.wf_windfall_property_value_1__c, Lead__r.wf_net_worth__c, '
        + 'Lead__r.wf_low_confidence_net_worth__c, Lead__r.wf_high_confidence_net_worth__c, '
        + 'Lead__r.wf_windfall_avm__c, Lead__r.wf_net_worth_calculation_date__c, '
        + 'Lead__r.wf_windfall_property_value_2__c, Lead__r.wf_windfall_property_value_3__c, '
        + 'Lead__r.Street, Lead__r.City, Lead__r.State, Lead__r.PostalCode, Lead__r.Country, '
        + 'Lead__r.Lead_Funnel_Time_Stamp__c, Lead__r.LeanData__Reporting_Matched_Account__c, '
        + 'Lead__r.LeanData__Reporting_Matched_Account__r.Name, '
        + 'Lead__r.Matched_Account_Opportunity_Count__c, Lead__r.Matched_Account_Order_Count__c, '
        + 'Lead__r.Matched_Account_Funnel_Stage__c, Lead__r.Matched_Account_Competitor__c';
    /** Instant estimates in the queue: only these Estimate_Amount__c values (no automatic price range). */
    @TestVisible static final Set<String> QUEUE_ESTIMATE_AMOUNTS = new Set<String>{ 'Custom' };
    @TestVisible static final String ESTIMATE_OBJECT = 'Website_Instant_Estimate__c';
    @TestVisible static final String ESTIMATE_FIELDS =
        'Id, Name, CreatedDate, LastModifiedDate, Instant_Estimate_Number_ID__c, First_Name__c, Last_Name__c, Company__c, Email_Address__c,'
        + ' Phone_Number__c, Customer_Type__c, Application__c, Frame_Type__c, Frame_Width__c, Frame_Height__c,'
        + ' Project_Classification__c, Gate_Variant__c, Estimate_Amount__c, Questions_or_Comments__c, Comments__c, Zip_or_Postal_Code__c,'
        + ' UTM_Source__c, UTM_Medium__c, UTM_Campaign__c, UTM_Term__c, UTM_Content__c, Playback_URL__c, Source_URL__c';
    /** Used when the LDR_Estimate_Date_Windows Custom Label is blank or unreadable: from Oct 1, 2026 00:00 Pacific. */
    @TestVisible static final Datetime DEFAULT_ESTIMATE_CUTOFF = Datetime.newInstanceGmt(2026, 10, 1, 7, 0, 0);
    /** Follow Up Information fields, same API names on Lead and Contact (read dynamically). */
    @TestVisible static final List<String> FOLLOW_UP_FIELDS = new List<String>{
        'sixsense_ce__campaign_name__c', 'sixsense_ce__status__c',
        'Outreach_Current_Active_Sequence_Name__c', 'Outreach_Finished_Sequences__c',
        // canvas 55a9: drives the Mine / All sequence buttons (not shown in the Follow Up card)
        'Outreach_Actively_being_Sequenced__c',
        // canvas 9fed: CE Last Synced Time (Follow Up card + 6sense outcome on cards)
        'sixsense_ce__last_synced_at__c'
    };
    /** 6Sense Option on Lead and Contact (X6Sense_Option__c); read/written dynamically in case a sandbox lacks it. */
    @TestVisible static final String SIX_SENSE_FIELD = 'X6Sense_Option__c';
    /** Finished tab: claimed submissions whose status left New/Working within this many days (was 7; Aqil 2026-10-27: 14). */
    @TestVisible static final Integer FINISHED_DAYS = 14;
    /** Prospects (instant estimates, 3D configurator people): a rolling window of this many days (canvas #149 B). */
    @TestVisible static final Integer PROSPECT_DAYS = 45;
    /** Fields the inbox's own Create Lead form may set. */
    @TestVisible static final Set<String> CREATE_LEAD_FIELDS = new Set<String>{
        'FirstName', 'LastName', 'Company', 'Email', 'Phone', 'Status', 'Type__c',
        'CountryCode', 'StateCode', 'Street', 'City', 'PostalCode'
    };

    // ---------------------------------------------------------------- DTOs

    public class QueueResult {
        @AuraEnabled public List<Form_Submission__c> submissions;
        @AuraEnabled public Id userId;
        @AuraEnabled public String userName;
        @AuraEnabled public List<String> statusOptions;
        @AuraEnabled public List<String> outcomeOptions;
        @AuraEnabled public Datetime loadedAt;
        /** Lead Id -> number of KBMax web quotes / website instant estimates on that Lead. */
        @AuraEnabled public Map<Id, Integer> kbmaxCounts;
        @AuraEnabled public Map<Id, Integer> estimateCounts;
        /** Fields removed because the user can't read them, e.g. "Form_Submission__c.Submit_Time__c". */
        @AuraEnabled public List<String> hiddenFields;
        /** Contact picklists (Contact.Lead_Funnel_Status__c etc. differ from the Lead ones). */
        @AuraEnabled public List<String> contactStatusOptions;
        @AuraEnabled public List<String> contactOutcomeOptions;
        /** Contact Id -> when the Lead that became this Contact was converted (Contact-linked rows only). */
        @AuraEnabled public Map<Id, Datetime> contactConvertedAt;
        /**
         * Submission Id -> name of the person who set Claimed_By__c to someone else ("assigned by").
         * Read from Form_Submission__c field history; empty until history tracking is on for Claimed_By__c.
         */
        @AuraEnabled public Map<Id, String> assignedBy;
        /** True for the inbox admins (View as, edit unclaimed rows without claiming). */
        @AuraEnabled public Boolean isAdmin;
        /** Project Coordinator choices in LDR Fields: User Id -> name for COORDINATOR_NAMES (active users only). */
        @AuraEnabled public Map<Id, String> coordinators;
        /** Admins: some claimed record still has Claimed_Date__c but no ClaimedDate__c (the one-time move, #156). */
        @AuraEnabled public Boolean legacyClaimDates = false;
        /**
         * Lead/Contact Id -> when its status (Lead.Status / Contact.Lead_Funnel_Status__c) last changed, from field
         * history. Claimed rows only. Drives the Finished tab and "set to Working".
         */
        @AuraEnabled public Map<Id, Datetime> statusChangedAt;
        /**
         * "<Lead or Contact Id>:<User Id>" -> latest Task/Event on that record owned or created by that user.
         * Claimed rows only, for the claimer. Drives the "No outreach" flag.
         */
        @AuraEnabled public Map<String, Datetime> lastActivityBy;
        /** Contact Id -> Contact.LeadType__c ("Lead Type"), for the Type filter on Contact rows. */
        @AuraEnabled public Map<Id, String> contactLeadTypes;
        /** Contact Id -> owner name of each open Opportunity the Contact has a Contact Role on. */
        @AuraEnabled public Map<Id, List<String>> openOppOwners;
        /**
         * Website_Instant_Estimate__c rows for the queue: Estimate_Amount__c = 'Custom', created on/after the cutoff
         * (Custom Label LDR_Estimate_Date_Windows). Empty until Claimed_By__c / ClaimedDate__c exist on that object.
         */
        @AuraEnabled public List<SObject> estimates;
        /** False until Website_Instant_Estimate__c has Claimed_By__c and ClaimedDate__c. */
        @AuraEnabled public Boolean estimatesEnabled;
        /** The instant-estimate date windows in effect (from LDR_Estimate_Date_Windows), as readable text. */
        @AuraEnabled public List<String> estimateWindows;
        /** Why the instant-estimate query failed, if it did (admins see it in the inbox). */
        @AuraEnabled public String estimateError;
        /**
         * Contacts reached only through a converted Lead (Lead__r.ConvertedContactId, Contact__c blank) or linked
         * alongside a Lead: Contact Id -> the Contact with the same fields as Contact__r, so the inbox shows the Contact.
         */
        @AuraEnabled public Map<Id, SObject> convertedContacts;
        /** Lead/Contact Id -> Follow Up Information (6sense CE campaign/status, Outreach sequences). */
        @AuraEnabled public Map<Id, Map<String, String>> followUp;
        /** Lead/Contact Id -> X6Sense_Option__c; plus the picklist values (empty when the field is missing). */
        @AuraEnabled public Map<Id, String> sixSense;
        @AuraEnabled public List<String> sixSenseOptions;
        /** Form submission Id -> Courses__c (Lunch & Learn Request forms). */
        @AuraEnabled public Map<Id, String> courses;
        /** Claimed 3D configurator prospects (one row per person, the row's record = their latest claimed quote). */
        @AuraEnabled public List<ConfigPerson> configurator;
        /** KBMax_Web_Quote__c has Claimed_By__c / ClaimedDate__c (3D configurator prospects can be claimed and worked). */
        @AuraEnabled public Boolean configuratorClaimable;
        /** Contact Id -> Windfall fields (the converted Lead's when the Contact has none yet; "__fromLead" = "true"). */
        @AuraEnabled public Map<Id, Map<String, String>> contactWindfall;
    }

    /**
     * A queue item: a Form_Submission__c or a Website_Instant_Estimate__c. Both carry Lead__c / Contact__c /
     * Claimed_By__c / ClaimedDate__c, so claim, release, save and hand-off work the same way for any of them.
     */
    public class Item {
        public SObject rec;
        /** Write copy holding only the fields the inbox changes (USER_MODE checks FLS on every field sent). */
        public SObject upd;
        public Id id;
        public Boolean isEstimate = false;
        /** A 3D configurator quote (KBMax_Web_Quote__c), claimable once it has Claimed_By__c / ClaimedDate__c. */
        public Boolean isKbmax = false;
        public String objectName;
        public Id leadId;
        public Id contactId;
        public Id claimedBy;
        public Datetime claimedAt;
        /** The old Date claim field (#156): only a fallback for claims the one-time move hasn't reached yet. */
        public Date claimedDay;
        public String email;
        public Datetime submittedAt;
        /** The Lead this item points at when the Contact is the working record (converted Lead, or both linked). */
        public Id convertedLeadId;
        /** Contact__c is blank and the Contact is only reachable via the converted Lead: claims write Contact__c. */
        public Boolean needsContactLink = false;
        public Item(SObject r) {
            rec = r;
            id = r.Id;
            upd = r.getSObjectType().newSObject(r.Id);
            isEstimate = r.getSObjectType() != Form_Submission__c.SObjectType;
            objectName = String.valueOf(r.getSObjectType());
            isKbmax = objectName == KBMAX_OBJECT;
            leadId = (Id) r.get('Lead__c');
            contactId = (Id) r.get('Contact__c');
            claimedBy = (Id) r.get('Claimed_By__c');
            claimedAt = (Datetime) r.get(CLAIMED_AT);
            claimedDay = (Date) r.get('Claimed_Date__c');
            email = (String) r.get(isKbmax ? 'Email__c' : 'Email_Address__c');
            Datetime st = isEstimate ? null : (Datetime) r.get('Submit_Time__c');
            submittedAt = st != null ? st : (Datetime) r.get('CreatedDate');
            Id viaLead = convertedContactOf(r);
            if (contactId == null && viaLead != null) {
                contactId = viaLead;
                convertedLeadId = leadId;
                leadId = null;
                needsContactLink = true;
            } else if (contactId != null && leadId != null) {
                convertedLeadId = leadId;
                leadId = null;
            }
        }
        /** Claims for user now (#156: ClaimedDate__c = now), or clears the claim when user is null. */
        public void setClaim(Id user) {
            Datetime at = user == null ? null : Datetime.now();
            upd.put('Claimed_By__c', user);
            upd.put(CLAIMED_AT, at);
            if (needsContactLink) {
                // workaround: point the submission at the Contact the Lead became, and clear the converted Lead (a111)
                upd.put('Contact__c', contactId);
                upd.put('Lead__c', null);
            }
            claimedBy = user;
            claimedAt = at;
        }
    }

    public class TimelineItem {
        @AuraEnabled public String key;
        @AuraEnabled public String label;
        @AuraEnabled public String oldValue;
        @AuraEnabled public String newValue;
        @AuraEnabled public String who;
        @AuraEnabled public Datetime happenedAt;
        /** Activity rows: 'call' | 'email' | 'task' | 'event' (from Task.TaskSubtype, or Event). */
        @AuraEnabled public String kind;
        /** Activity rows: Task/Event Description (comments / email body). */
        @AuraEnabled public String body;
    }

    public class LeadTimeline {
        @AuraEnabled public List<TimelineItem> history = new List<TimelineItem>();
        @AuraEnabled public List<TimelineItem> activity = new List<TimelineItem>();
    }

    public class RelatedItem {
        @AuraEnabled public Id recordId;
        @AuraEnabled public String source;      // 'kbmax' | 'estimate' | 'opportunity'
        @AuraEnabled public String kind;
        @AuraEnabled public String name;
        @AuraEnabled public String summary;
        @AuraEnabled public String amount;
        @AuraEnabled public String status;
        @AuraEnabled public String note;
        @AuraEnabled public Date closeDate;
        @AuraEnabled public Datetime createdDate;
        @AuraEnabled public String owner;
        @AuraEnabled public String recordType;
        /** Opportunities: the Project (Opportunity.Project_Name__c lookup). */
        @AuraEnabled public Id projectId;
        @AuraEnabled public String projectName;
        /** Opportunity.Project_Name__r.Owner.Name (canvas aabc, #96C). */
        @AuraEnabled public String projectOwner;
    }

    public class ClaimContext {
        @AuraEnabled public String tookOverFrom;       // previous coordinator's name, if the claim replaced someone
        /** When the claim happened (#152 E: the take-over reminder shows for 24 hours after it). */
        @AuraEnabled public Datetime claimedAt;
        public Boolean coordinatorChangedByClaim = false;
        @AuraEnabled public Id previousCoordinatorId;
        @AuraEnabled public String previousCoordinatorName;
        /** True when someone else was Project Coordinator before this claim (Reassign gives it back to them). */
        @AuraEnabled public Boolean canReassign = false;
        public Boolean funnelTsChangedByClaim = false;
        public Date previousFunnelTs;
        public Boolean noHistory = true;
    }

    /** Same shape for LeadHistory and ContactHistory rows. */
    public class HistoryRow {
        public String rowKey;
        public String field;
        public String dataType;
        public Object oldValue;
        public Object newValue;
        public String createdByName;
        public Datetime createdAt;
        public HistoryRow(SObject r) {
            rowKey = String.valueOf(r.get('Id'));
            field = (String) r.get('Field');
            dataType = (String) r.get('DataType');
            oldValue = r.get('OldValue');
            newValue = r.get('NewValue');
            SObject creator = r.getSObject('CreatedBy');
            createdByName = creator == null ? null : (String) creator.get('Name');
            createdAt = (Datetime) r.get('CreatedDate');
        }
    }

    public class PersonSubmission {
        @AuraEnabled public Id recordId;
        @AuraEnabled public String inquiryType;
        @AuraEnabled public Id claimedById;
        @AuraEnabled public String claimedByName;
        @AuraEnabled public Id leadId;
        @AuraEnabled public Datetime submittedAt;
        @AuraEnabled public String projectName;
        @AuraEnabled public String comments;
    }

    public class AccountSummary {
        @AuraEnabled public Id accountId;
        @AuraEnabled public String city;
        @AuraEnabled public String state;
        @AuraEnabled public String website;
        @AuraEnabled public Integer opportunityTotal = 0;
        @AuraEnabled public List<RelatedItem> opportunities = new List<RelatedItem>();
    }

    // ---------------------------------------------------------------- Reads

    @AuraEnabled
    public static QueueResult getQueue(Integer lookbackDays) {
        Integer days = (lookbackDays == null || lookbackDays < 1 || lookbackDays > 365)
            ? DEFAULT_LOOKBACK_DAYS : lookbackDays;
        Datetime since = Datetime.now().addDays(-days);
        Id me = UserInfo.getUserId();
        Integer maxRows = MAX_ROWS;

        QueueResult r = new QueueResult();
        r.userId = me;
        r.userName = UserInfo.getName();
        r.loadedAt = Datetime.now();
        r.isAdmin = isAdmin();
        r.legacyClaimDates = r.isAdmin && legacyClaimDatesLeft();
        r.coordinators = coordinatorUsers();
        r.statusOptions = picklistValues(Lead.Status.getDescribe());
        r.outcomeOptions = picklistValues(Lead.Lead_Funnel_Outcome__c.getDescribe());
        r.contactStatusOptions = picklistValues(Contact.Lead_Funnel_Status__c.getDescribe());
        r.contactOutcomeOptions = picklistValues(Contact.Lead_Funnel_Outcome__c.getDescribe());
        Set<String> excludedInquiries = EXCLUDED_INQUIRIES;
        Set<String> activeStatuses = ACTIVE_STATUSES;
        Datetime finishedSince = Datetime.now().addDays(-FINISHED_DAYS);
        if (!Schema.SObjectType.Form_Submission__c.isAccessible()) {
            throw auraError('You don\'t have access to Form Submissions. Ask your admin for the LDR Inbox User permission set.');
        }
        List<Form_Submission__c> rows;
        try {
            rows = [
                SELECT Id, Name, Type__c, Submit_Time__c, CreatedDate, LastModifiedDate,
                       First_Name__c, Last_Name__c, Company__c, Email_Address__c, Phone_Number__c,
                       Customer_Type__c, Inquiry_Type__c, Project_Type__c, Project_Construction_Classification__c,
                       Project_Application__c,
                       Application__c, Product_Type__c, Project_Timeline__c, Project_Name__c,
                       Project_Postal_Code__c, Zip_or_Postal_Code__c, City__c, State_or_Province__c,
                       Country__c, Questions_or_Comments__c, Comments__c, Comments1__c, Attachments__c,
                       UTM_Source__c, UTM_Medium__c, UTM_Campaign__c, UTM_Term__c, UTM_Content__c, Playback_URL__c,
                       Contact__c, Contact__r.Name, Contact__r.Email, Contact__r.Account.Name, Contact__r.Owner.Name,
                       Contact__r.MailingCity, Contact__r.MailingState, Contact__r.MailingPostalCode,
                       Contact__r.AccountId, Contact__r.CreatedDate,
                       Contact__r.MailingLatitude, Contact__r.MailingLongitude, Lead__r.Latitude, Lead__r.Longitude,
                       Contact__r.Project_Coordinator__c, Contact__r.Project_Coordinator__r.Name,
                       Contact__r.Lead_Funnel_Time_Stamp__c, Contact__r.Lead_Funnel_Status__c,
                       Contact__r.Lead_Funnel_Outcome__c,
                       Claimed_By__c, Claimed_By__r.Name, ClaimedDate__c,
                       Lead__c, Lead__r.Name, Lead__r.Email, Lead__r.Type__c, Lead__r.Status,
                       Lead__r.IsConverted, Lead__r.ConvertedDate, Lead__r.ConvertedContactId, Lead__r.Lead_Funnel_Outcome__c,
                       Lead__r.LDR_Project_Name__c, Lead__r.LDR_Notes__c,
                       Lead__r.Project_Coordinator__c, Lead__r.Project_Coordinator__r.Name,
                       Lead__r.Owner.Name, Lead__r.Windfall_Lead_Grade__c,
                       Lead__r.Outreach_Current_Sequence_Status__c,
                       Lead__r.Project_Name__c,
                       Lead__r.Territory__c, Contact__r.Territory__c,
                       Lead__r.Type_of_record__c, Lead__r.Project_Application_Industry__c,
                       Lead__r.wf_windfall_property_value_1__c, Lead__r.wf_net_worth__c,
                       Lead__r.wf_low_confidence_net_worth__c, Lead__r.wf_high_confidence_net_worth__c,
                       Lead__r.wf_windfall_avm__c, Lead__r.wf_net_worth_calculation_date__c,
                       Lead__r.wf_windfall_property_value_2__c, Lead__r.wf_windfall_property_value_3__c,
                       Lead__r.Street, Lead__r.City, Lead__r.State, Lead__r.PostalCode, Lead__r.Country, Lead__r.Lead_Funnel_Time_Stamp__c,
                       Lead__r.LeanData__Reporting_Matched_Account__c,
                       Lead__r.LeanData__Reporting_Matched_Account__r.Name,
                       Lead__r.Matched_Account_Opportunity_Count__c, Lead__r.Matched_Account_Order_Count__c,
                       Lead__r.Matched_Account_Funnel_Stage__c, Lead__r.Matched_Account_Competitor__c
                FROM Form_Submission__c
                // Lead-linked (unconverted), Contact-linked, or not linked yet (Eloqua/Salesforce hasn't caught up).
                // Converted Leads only for my own recent claims (Finished tab).
                // Submissions on a converted Lead are included and shown as the Contact the Lead became.
                WHERE (Inquiry_Type__c = null OR Inquiry_Type__c NOT IN :excludedInquiries)
                  // Also every LDR's claims still being worked (New / Working), however old, so the All tab and
                  // View-as show them like the canvas does (2026-10-14).
                  AND (CreatedDate >= :since OR Claimed_By__c = :me
                       OR (Claimed_By__c != null AND (Lead__r.Status IN :activeStatuses
                           OR Contact__r.Lead_Funnel_Status__c IN :activeStatuses))
                       // Canvas #108: every LDR's claims finished in the last FINISHED_DAYS days (14) also show in All (converted
                       // Contacts, Qualified, Nurture, ...). A claim, status change or conversion touches the Lead /
                       // Contact, so LastModifiedDate in the window is a superset; the LWC applies the exact rule.
                       OR (Claimed_By__c != null AND (Lead__r.LastModifiedDate >= :finishedSince
                           OR Contact__r.LastModifiedDate >= :finishedSince)))
                // Newest first, so if the cap is ever reached the oldest rows are the ones left out (2026-10-14).
                ORDER BY CreatedDate DESC
                LIMIT :maxRows
            ];
        } catch (Exception e) {
            throw auraError('Could not load the LDR queue: ' + e.getMessage());
        }
        SObjectAccessDecision decision = Security.stripInaccessible(AccessType.READABLE, rows);
        r.submissions = (List<Form_Submission__c>) decision.getRecords();
        r.hiddenFields = new List<String>();
        Map<String, Set<String>> removed = decision.getRemovedFields();
        for (String obj : removed.keySet()) {
            for (String f : removed.get(obj)) {
                r.hiddenFields.add(obj + '.' + f);
            }
        }
        r.hiddenFields.sort();
        r.estimatesEnabled = estimatesClaimable();
        r.estimateWindows = estimateWindowLabels();
        r.estimates = new List<SObject>();
        if (r.estimatesEnabled) {
            try {
                // Unclaimed: only the date windows decide which estimates show (the lookback days don't apply).
                // Claimed (Custom or price range, canvas #149 D): kept like claimed form submissions, with no start
                // date: still New / Working, or touched within FINISHED_DAYS (the LWC applies the exact Finished rule).
                // Before, a claimed Custom estimate outside the windows never loaded (#148: the uncontacted list then
                // opened its Lead).
                Map<String, Object> binds = new Map<String, Object>{
                    'amounts' => QUEUE_ESTIMATE_AMOUNTS, 'maxRows' => maxRows,
                    'activeStatuses' => activeStatuses, 'finishedSince' => finishedSince
                };
                List<SObject> ests = Database.queryWithBinds(
                    'SELECT ' + estimateSelectList()
                    + ' FROM ' + ESTIMATE_OBJECT
                    + ' WHERE (Estimate_Amount__c IN :amounts AND ' + estimateWindowClause(binds) + ')'
                    + ' OR (Claimed_By__c != null AND (Lead__r.Status IN :activeStatuses'
                    + ' OR Contact__r.Lead_Funnel_Status__c IN :activeStatuses'
                    + ' OR Lead__r.LastModifiedDate >= :finishedSince OR Contact__r.LastModifiedDate >= :finishedSince))'
                    + ' ORDER BY CreatedDate DESC LIMIT :maxRows', binds, AccessLevel.SYSTEM_MODE);
                SObjectAccessDecision estDecision = Security.stripInaccessible(AccessType.READABLE, ests);
                r.estimates = estDecision.getRecords();
                Map<String, Set<String>> estRemoved = estDecision.getRemovedFields();
                for (String obj : estRemoved.keySet()) {
                    for (String f : estRemoved.get(obj)) {
                        r.hiddenFields.add(obj + '.' + f);
                    }
                }
                r.hiddenFields.sort();
            } catch (Exception e) {
                // Shown to admins in the inbox, so a failing query isn't silent (it was: duplicate fields, 2026-10-08).
                r.estimateError = e.getMessage();
                System.debug(LoggingLevel.WARN, 'Instant estimates not readable: ' + e.getMessage());
            }
        }
        List<SObject> allItems = new List<SObject>();
        allItems.addAll((List<SObject>) r.submissions);
        allItems.addAll(r.estimates);
        Set<Id> leadIds = new Set<Id>();
        Set<Id> contactIds = new Set<Id>();
        Set<Id> formIds = new Set<Id>();
        Set<Id> viaLeadContacts = new Set<Id>();
        for (SObject f : allItems) {
            Id cid = effectiveContactId(f);
            Id lid = cid == null ? (Id) f.get('Lead__c') : null;
            if (lid != null) {
                leadIds.add(lid);
            } else if (cid != null) {
                contactIds.add(cid);
                if (f.get('Contact__c') == null || f.get('Lead__c') != null) {
                    viaLeadContacts.add(cid);
                }
            }
            if (f.getSObjectType() == Form_Submission__c.SObjectType) {
                formIds.add(f.Id);
            }
        }
        // Claimed 3D configurator prospects (KBMax_Web_Quote__c claim fields; none until those fields exist).
        r.configurator = new List<ConfigPerson>();
        r.configuratorClaimable = kbmaxClaimable();
        try {
            r.configurator = configuratorPeople(prospectSince(), true, null);
        } catch (Exception e) {
            r.estimateError = (String.isBlank(r.estimateError) ? '' : r.estimateError + ' | ') + '3D configurator: ' + e.getMessage();
        }
        for (ConfigPerson p : r.configurator) {
            if (p.isContact) {
                contactIds.add(p.personId);
            } else {
                leadIds.add(p.personId);
            }
        }
        r.convertedContacts = contactsFor(viaLeadContacts);
        r.followUp = followUpFor(leadIds, contactIds);
        r.contactWindfall = contactWindfallFor(contactIds);
        // KBMax quotes / instant estimates are linked by Lead__c on Lead rows and by Contact__c on Contact rows.
        r.kbmaxCounts = countByLookup('KBMax_Web_Quote__c', 'Lead__c', leadIds);
        r.kbmaxCounts.putAll(countByLookup('KBMax_Web_Quote__c', 'Contact__c', contactIds));
        r.estimateCounts = countByLookup('Website_Instant_Estimate__c', 'Lead__c', leadIds);
        r.estimateCounts.putAll(countByLookup('Website_Instant_Estimate__c', 'Contact__c', contactIds));
        r.contactConvertedAt = convertedAtFor(contactIds);
        r.contactLeadTypes = contactLeadTypesFor(contactIds);
        r.openOppOwners = openOppOwnersFor(contactIds);
        r.sixSense = sixSenseFor(leadIds, contactIds);
        r.sixSenseOptions = sixSenseOptions();
        r.courses = coursesFor(formIds);
        Set<Id> claimedIds = new Set<Id>();
        Set<Id> claimedEstimateIds = new Set<Id>();
        Set<Id> claimedLeads = new Set<Id>();
        Set<Id> claimedContacts = new Set<Id>();
        Set<Id> claimers = new Set<Id>();
        for (SObject f : allItems) {
            Id claimer = (Id) f.get('Claimed_By__c');
            if (claimer == null) {
                continue;
            }
            if (f.getSObjectType() == Form_Submission__c.SObjectType) {
                claimedIds.add(f.Id);
            } else {
                claimedEstimateIds.add(f.Id);
            }
            claimers.add(claimer);
            Id cid = effectiveContactId(f);
            Id lid = cid == null ? (Id) f.get('Lead__c') : null;
            if (lid != null) {
                claimedLeads.add(lid);
            } else if (cid != null) {
                claimedContacts.add(cid);
            }
        }
        r.assignedBy = assignedByFor(claimedIds);
        r.assignedBy.putAll(assignedByFor(claimedEstimateIds, 'Website_Instant_Estimate__History'));
        r.statusChangedAt = statusChangedFor(claimedLeads, claimedContacts);
        Set<Id> claimedRecords = new Set<Id>(claimedLeads);
        claimedRecords.addAll(claimedContacts);
        r.lastActivityBy = lastActivityFor(claimedRecords, claimers);
        return r;
    }

    /** True for the inbox admins. */
    @TestVisible
    private static Boolean isAdmin() {
        return adminUserIds.contains(UserInfo.getUserId());
    }

    /** Instant estimates can be queue items only once they have their own claim fields. */
    @TestVisible
    private static Boolean estimatesClaimable() {
        return hasField(ESTIMATE_OBJECT, 'Claimed_By__c') && hasField(ESTIMATE_OBJECT, CLAIMED_AT)
            && hasField(ESTIMATE_OBJECT, 'Lead__c') && hasField(ESTIMATE_OBJECT, 'Contact__c');
    }

    /**
     * Instant-estimate date windows from Custom Label LDR_Estimate_Date_Windows. Format: windows separated by ";",
     * each "start..end" (end exclusive) or just "start" (no end), as ISO date-times with an offset, e.g.
     * 2026-06-15T00:00:00-07:00..2026-07-01T00:00:00-07:00;2026-10-05T00:00:00-07:00
     * Change the label in Setup to move the windows; no deployment needed. Invalid parts are skipped; if nothing
     * valid remains the default (from Oct 1, 2026 Pacific) applies. Each window is [start, end-or-null].
     */
    @TestVisible
    private static List<List<Datetime>> estimateWindows() {
        String v;
        try {
            v = System.Label.LDR_Estimate_Date_Windows;
        } catch (Exception e) {
            v = null;
        }
        List<List<Datetime>> out = parseWindows(v);
        if (out.isEmpty()) {
            out.add(new List<Datetime>{ DEFAULT_ESTIMATE_CUTOFF, null });
        }
        return out;
    }

    @TestVisible
    private static List<List<Datetime>> parseWindows(String v) {
        List<List<Datetime>> out = new List<List<Datetime>>();
        if (String.isBlank(v)) {
            return out;
        }
        for (String raw : v.split(';')) {
            String part = raw.trim();
            if (part == '') {
                continue;
            }
            try {
                Integer dots = part.indexOf('..');
                Datetime startAt = parseIsoDatetime(dots < 0 ? part : part.substring(0, dots));
                String endText = dots < 0 ? '' : part.substring(dots + 2).trim();
                Datetime endAt = String.isBlank(endText) ? null : parseIsoDatetime(endText);
                out.add(new List<Datetime>{ startAt, endAt });
            } catch (Exception e) {
                System.debug(LoggingLevel.WARN, 'Skipping invalid estimate window "' + part + '": ' + e.getMessage());
            }
        }
        return out;
    }

    /** "2026-06-15T00:00:00-07:00", "...Z" or "2026-06-15" (midnight GMT) -> Datetime. */
    @TestVisible
    private static Datetime parseIsoDatetime(String text) {
        String t = text.trim();
        if (t.length() == 10) {
            return Datetime.valueOfGmt(t + ' 00:00:00');
        }
        Datetime base = Datetime.valueOfGmt(t.substring(0, 10) + ' ' + t.substring(11, 19));
        String zone = t.substring(19);
        Integer dot = zone.indexOf('.');
        if (dot == 0) {
            Integer i = 1;
            while (i < zone.length() && zone.substring(i, i + 1).isNumeric()) {
                i++;
            }
            zone = zone.substring(i);
        }
        if (zone == '' || zone == 'Z') {
            return base;
        }
        Integer sign = zone.startsWith('-') ? -1 : 1;
        String hhmm = zone.substring(1).replace(':', '');
        Integer minutes = Integer.valueOf(hhmm.substring(0, 2)) * 60 + (hhmm.length() >= 4 ? Integer.valueOf(hhmm.substring(2, 4)) : 0);
        return base.addMinutes(-sign * minutes);
    }

    /** SOQL condition for the windows; adds its bind values to binds (ews0, ewe0, ...). */
    @TestVisible
    private static String estimateWindowClause(Map<String, Object> binds) {
        List<String> parts = new List<String>();
        Integer i = 0;
        for (List<Datetime> w : estimateWindows()) {
            String sk = 'ews' + i;
            binds.put(sk, w[0]);
            String cond = 'CreatedDate >= :' + sk;
            if (w[1] != null) {
                String ek = 'ewe' + i;
                binds.put(ek, w[1]);
                cond += ' AND CreatedDate < :' + ek;
            }
            parts.add('(' + cond + ')');
            i++;
        }
        return '(' + String.join(parts, ' OR ') + ')';
    }

    @TestVisible
    private static List<String> estimateWindowLabels() {
        List<String> out = new List<String>();
        for (List<Datetime> w : estimateWindows()) {
            out.add(w[0].format('MMM d, yyyy h:mm a z', PACIFIC_TZ)
                + (w[1] == null ? ' onward' : ' to ' + w[1].addSeconds(-1).format('MMM d, yyyy h:mm a z', PACIFIC_TZ)));
        }
        return out;
    }

    /** The Contact a converted Lead became, when Contact__c is blank (else Contact__c itself), from Lead__r. */
    @TestVisible
    private static Id convertedContactOf(SObject f) {
        SObject l;
        try {
            l = f.getSObject('Lead__r');
        } catch (Exception e) {
            l = null;
        }
        if (l != null && l.get('IsConverted') == true) {
            return (Id) l.get('ConvertedContactId');
        }
        return null;
    }

    /** The Contact the inbox works on: Contact__c, else the converted Lead's Contact. Null for a Lead row. */
    @TestVisible
    private static Id effectiveContactId(SObject f) {
        Id cid = (Id) f.get('Contact__c');
        return cid != null ? cid : convertedContactOf(f);
    }

    /** Contacts with the same fields the queue reads through Contact__r (for rows that reach them via a Lead). */
    @TestVisible
    private static Map<Id, SObject> contactsFor(Set<Id> contactIds) {
        Map<Id, SObject> out = new Map<Id, SObject>();
        if (contactIds == null || contactIds.isEmpty()) {
            return out;
        }
        List<String> fields = new List<String>{ 'Id' };
        for (String f : LINKED_RECORD_FIELDS.split(',')) {
            String t = f.trim();
            if (t.startsWith('Contact__r.')) {
                fields.add(t.substring('Contact__r.'.length()));
            }
        }
        try {
            for (SObject c : Security.stripInaccessible(AccessType.READABLE, Database.queryWithBinds(
                    'SELECT ' + String.join(fields, ', ') + ' FROM Contact WHERE Id IN :ids',
                    new Map<String, Object>{ 'ids' => contactIds }, AccessLevel.SYSTEM_MODE)).getRecords()) {
                out.put(c.Id, c);
            }
        } catch (Exception e) {
            System.debug(LoggingLevel.WARN, 'Converted Contacts not readable: ' + e.getMessage());
        }
        return out;
    }

    /** Lead/Contact Id -> Follow Up Information fields that exist on that object (dynamic). */
    @TestVisible
    private static Map<Id, Map<String, String>> followUpFor(Set<Id> leadIds, Set<Id> contactIds) {
        Map<Id, Map<String, String>> out = new Map<Id, Map<String, String>>();
        Map<String, Set<Id>> byObject = new Map<String, Set<Id>>{ 'Lead' => leadIds, 'Contact' => contactIds };
        for (String obj : byObject.keySet()) {
            Set<Id> ids = byObject.get(obj);
            List<String> present = new List<String>();
            for (String f : FOLLOW_UP_FIELDS) {
                if (hasField(obj, f)) {
                    present.add(f);
                }
            }
            if (ids == null || ids.isEmpty() || present.isEmpty()) {
                continue;
            }
            try {
                for (SObject x : Security.stripInaccessible(AccessType.READABLE, Database.queryWithBinds(
                        'SELECT Id, ' + String.join(present, ', ') + ' FROM ' + obj + ' WHERE Id IN :ids',
                        new Map<String, Object>{ 'ids' => ids }, AccessLevel.SYSTEM_MODE)).getRecords()) {
                    Map<String, String> vals = new Map<String, String>();
                    for (String f : present) {
                        if (x.isSet(f) && x.get(f) != null) {
                            Object v = x.get(f);
                            // sixsense_ce__last_synced_at__c is a Datetime: send ISO 8601 GMT. String.valueOf gave
                            // "2026-10-21 14:05:00" (GMT, no zone), which browsers read as local time or reject.
                            vals.put(f, v instanceof Datetime
                                ? ((Datetime) v).formatGmt('yyyy-MM-dd\'T\'HH:mm:ss\'Z\'')
                                : String.valueOf(v));
                        }
                    }
                    out.put(x.Id, vals);
                }
            } catch (Exception e) {
                System.debug(LoggingLevel.WARN, 'Follow Up fields not readable on ' + obj + ': ' + e.getMessage());
            }
        }
        return out;
    }

    /** Lead/Contact Id -> X6Sense_Option__c (dynamic: empty where the field is missing). */
    @TestVisible
    private static Map<Id, String> sixSenseFor(Set<Id> leadIds, Set<Id> contactIds) {
        Map<Id, String> out = new Map<Id, String>();
        try {
            if (!leadIds.isEmpty() && hasField('Lead', SIX_SENSE_FIELD)) {
                for (SObject x : Security.stripInaccessible(AccessType.READABLE,
                        Database.query('SELECT Id, ' + SIX_SENSE_FIELD + ' FROM Lead WHERE Id IN :leadIds')).getRecords()) {
                    if (x.isSet(SIX_SENSE_FIELD) && x.get(SIX_SENSE_FIELD) != null) {
                        out.put(x.Id, String.valueOf(x.get(SIX_SENSE_FIELD)));
                    }
                }
            }
            if (!contactIds.isEmpty() && hasField('Contact', SIX_SENSE_FIELD)) {
                for (SObject x : Security.stripInaccessible(AccessType.READABLE,
                        Database.query('SELECT Id, ' + SIX_SENSE_FIELD + ' FROM Contact WHERE Id IN :contactIds')).getRecords()) {
                    if (x.isSet(SIX_SENSE_FIELD) && x.get(SIX_SENSE_FIELD) != null) {
                        out.put(x.Id, String.valueOf(x.get(SIX_SENSE_FIELD)));
                    }
                }
            }
        } catch (Exception e) {
            System.debug(LoggingLevel.WARN, '6Sense Option not readable: ' + e.getMessage());
        }
        return out;
    }

    /** Active X6Sense_Option__c values (from Lead), or empty when the field is missing. */
    @TestVisible
    private static List<String> sixSenseOptions() {
        Schema.SObjectField f = Schema.SObjectType.Lead.fields.getMap().get(SIX_SENSE_FIELD.toLowerCase());
        return f == null ? new List<String>() : picklistValues(f.getDescribe());
    }

    /** Form submission Id -> Courses__c (Lunch & Learn), dynamic so it compiles without the field. */
    @TestVisible
    private static Map<Id, String> coursesFor(Set<Id> formIds) {
        Map<Id, String> out = new Map<Id, String>();
        if (formIds.isEmpty() || !hasField('Form_Submission__c', 'Courses__c')) {
            return out;
        }
        try {
            for (SObject x : Security.stripInaccessible(AccessType.READABLE, Database.query(
                    'SELECT Id, Courses__c FROM Form_Submission__c WHERE Id IN :formIds AND Courses__c != null')).getRecords()) {
                if (x.isSet('Courses__c')) {
                    out.put(x.Id, String.valueOf(x.get('Courses__c')));
                }
            }
        } catch (Exception e) {
            System.debug(LoggingLevel.WARN, 'Courses not readable: ' + e.getMessage());
        }
        return out;
    }

    /** Latest status change per Lead (LeadHistory Status) / Contact (ContactHistory Lead_Funnel_Status__c). */
    @TestVisible
    private static Map<Id, Datetime> statusChangedFor(Set<Id> leadIds, Set<Id> contactIds) {
        Map<Id, Datetime> out = new Map<Id, Datetime>();
        try {
            if (!leadIds.isEmpty()) {
                for (LeadHistory h : [SELECT LeadId, CreatedDate FROM LeadHistory
                                      WHERE LeadId IN :leadIds AND Field = 'Status'
                                      ORDER BY CreatedDate DESC LIMIT 2000]) {
                    if (!out.containsKey(h.LeadId)) {
                        out.put(h.LeadId, h.CreatedDate);
                    }
                }
            }
            if (!contactIds.isEmpty()) {
                for (ContactHistory h : [SELECT ContactId, CreatedDate FROM ContactHistory
                                         WHERE ContactId IN :contactIds AND Field = 'Lead_Funnel_Status__c'
                                         ORDER BY CreatedDate DESC LIMIT 2000]) {
                    if (!out.containsKey(h.ContactId)) {
                        out.put(h.ContactId, h.CreatedDate);
                    }
                }
            }
        } catch (Exception e) {
            System.debug(LoggingLevel.WARN, 'Status history not readable: ' + e.getMessage());
        }
        return out;
    }

    /**
     * Latest Task/Event per (record, user) where that user owns or created it. Includes Outreach-synced
     * emails/calls (they are Tasks owned by the rep). Key: "<WhoId>:<UserId>".
     */
    @TestVisible
    private static Map<String, Datetime> lastActivityFor(Set<Id> recordIds, Set<Id> userIds) {
        Map<String, Datetime> out = new Map<String, Datetime>();
        if (recordIds.isEmpty() || userIds.isEmpty()) {
            return out;
        }
        try {
            for (Task t : [SELECT WhoId, OwnerId, CreatedById, CreatedDate FROM Task
                           WHERE WhoId IN :recordIds AND (OwnerId IN :userIds OR CreatedById IN :userIds)
                           ORDER BY CreatedDate DESC LIMIT 2000]) {
                noteActivity(out, t.WhoId, t.OwnerId, t.CreatedDate);
                noteActivity(out, t.WhoId, t.CreatedById, t.CreatedDate);
            }
            for (Event ev : [SELECT WhoId, OwnerId, CreatedById, CreatedDate FROM Event
                             WHERE WhoId IN :recordIds AND (OwnerId IN :userIds OR CreatedById IN :userIds)
                             ORDER BY CreatedDate DESC LIMIT 2000]) {
                noteActivity(out, ev.WhoId, ev.OwnerId, ev.CreatedDate);
                noteActivity(out, ev.WhoId, ev.CreatedById, ev.CreatedDate);
            }
        } catch (Exception e) {
            System.debug(LoggingLevel.WARN, 'Activity not readable: ' + e.getMessage());
        }
        return out;
    }

    private static void noteActivity(Map<String, Datetime> out, Id whoId, Id userId, Datetime at) {
        if (whoId == null || userId == null || at == null) {
            return;
        }
        String key = String.valueOf(whoId) + ':' + String.valueOf(userId);
        Datetime prev = out.get(key);
        if (prev == null || at > prev) {
            out.put(key, at);
        }
    }

    /** Contact Id -> LeadType__c. Dynamic, so the class compiles in an org without the field. */
    @TestVisible
    private static Map<Id, String> contactLeadTypesFor(Set<Id> contactIds) {
        Map<Id, String> out = new Map<Id, String>();
        if (contactIds == null || contactIds.isEmpty() || contactField('LeadType__c') == null) {
            return out;
        }
        try {
            List<SObject> rows = Security.stripInaccessible(AccessType.READABLE,
                Database.query('SELECT Id, LeadType__c FROM Contact WHERE Id IN :contactIds')).getRecords();
            for (SObject c : rows) {
                if (c.isSet('LeadType__c') && c.get('LeadType__c') != null) {
                    out.put(c.Id, String.valueOf(c.get('LeadType__c')));
                }
            }
        } catch (Exception e) {
            System.debug(LoggingLevel.WARN, 'Contact Lead Type not readable: ' + e.getMessage());
        }
        return out;
    }

    /** Contact Id -> one owner name per open Opportunity (OpportunityContactRole, IsClosed = false). */
    @TestVisible
    private static Map<Id, List<String>> openOppOwnersFor(Set<Id> contactIds) {
        Map<Id, List<String>> out = new Map<Id, List<String>>();
        if (contactIds == null || contactIds.isEmpty()) {
            return out;
        }
        try {
            Set<String> seen = new Set<String>();
            List<OpportunityContactRole> roles = (List<OpportunityContactRole>) Security.stripInaccessible(
                AccessType.READABLE,
                [SELECT ContactId, OpportunityId, Opportunity.Owner.Name FROM OpportunityContactRole
                 WHERE ContactId IN :contactIds AND Opportunity.IsClosed = false LIMIT 2000]).getRecords();
            for (OpportunityContactRole ocr : roles) {
                if (!seen.add(String.valueOf(ocr.ContactId) + ':' + String.valueOf(ocr.OpportunityId))) {
                    continue;
                }
                if (!out.containsKey(ocr.ContactId)) {
                    out.put(ocr.ContactId, new List<String>());
                }
                String owner = (ocr.Opportunity != null && ocr.Opportunity.Owner != null) ? ocr.Opportunity.Owner.Name : '';
                out.get(ocr.ContactId).add(owner == null ? '' : owner);
            }
        } catch (Exception e) {
            System.debug(LoggingLevel.WARN, 'Open opportunities not readable: ' + e.getMessage());
        }
        return out;
    }

    /**
     * Who last set Claimed_By__c, when it was someone other than the new claimer (i.e. an assignment).
     * Uses Form_Submission__History through dynamic SOQL: that object only exists once field history is
     * enabled on Form_Submission__c (it isn't in production as of 2026-10-02), so a static query would not
     * compile there. Returns an empty map when history is off.
     */
    @TestVisible
    private static Map<Id, String> assignedByFor(Set<Id> submissionIds) {
        return assignedByFor(submissionIds, 'Form_Submission__History');
    }

    @TestVisible
    private static Map<Id, String> assignedByFor(Set<Id> submissionIds, String historyObject) {
        Map<Id, String> out = new Map<Id, String>();
        if (submissionIds == null || submissionIds.isEmpty()
                || !Schema.getGlobalDescribe().containsKey(historyObject.toLowerCase())) {
            return out;
        }
        try {
            Set<Id> seen = new Set<Id>();
            for (SObject h : Database.query(
                    'SELECT ParentId, NewValue, CreatedById, CreatedBy.Name, DataType FROM ' + historyObject
                    + ' WHERE Field = \'Claimed_By__c\' AND ParentId IN :submissionIds ORDER BY CreatedDate DESC')) {
                Id parentId = (Id) h.get('ParentId');
                if ((String) h.get('DataType') != 'EntityId' || seen.contains(parentId)) {
                    continue;
                }
                seen.add(parentId);
                Object nv = h.get('NewValue');
                Id changedBy = (Id) h.get('CreatedById');
                if (nv != null && changedBy != null && String.valueOf(nv) != String.valueOf(changedBy)) {
                    SObject creator = h.getSObject('CreatedBy');
                    out.put(parentId, creator == null ? null : (String) creator.get('Name'));
                }
            }
        } catch (Exception e) {
            System.debug(LoggingLevel.WARN, 'Form submission history not readable: ' + e.getMessage());
        }
        return out;
    }

    @TestVisible static final String CONTACT_STATUS_REASON = 'Status_Reason__c';

    /** True when this org has Contact.Status_Reason__c (production does; older sandboxes may not). */
    @TestVisible
    private static Boolean contactHasStatusReason() {
        return contactField(CONTACT_STATUS_REASON) != null;
    }

    private static Schema.SObjectField contactField(String apiName) {
        return Schema.SObjectType.Contact.fields.getMap().get(apiName.toLowerCase());
    }

    /**
     * When each Contact was created by converting a Lead. Lead.ConvertedDate is only a date, so the
     * Contact's CreatedDate is used as the time when it falls on/next to that date (conversion creates
     * the Contact); otherwise midnight of ConvertedDate. Contacts never converted from a Lead are absent.
     */
    @TestVisible
    private static Map<Id, Datetime> convertedAtFor(Set<Id> contactIds) {
        Map<Id, Datetime> out = new Map<Id, Datetime>();
        if (contactIds == null || contactIds.isEmpty()) {
            return out;
        }
        try {
            Map<Id, Contact> contacts = new Map<Id, Contact>([SELECT Id, CreatedDate FROM Contact WHERE Id IN :contactIds]);
            for (Lead l : [SELECT ConvertedContactId, ConvertedDate FROM Lead
                           WHERE IsConverted = true AND ConvertedContactId IN :contactIds
                           ORDER BY ConvertedDate DESC]) {
                if (out.containsKey(l.ConvertedContactId) || l.ConvertedDate == null) {
                    continue;
                }
                Contact c = contacts.get(l.ConvertedContactId);
                Datetime at = Datetime.newInstance(l.ConvertedDate, Time.newInstance(0, 0, 0, 0));
                if (c != null && Math.abs(c.CreatedDate.date().daysBetween(l.ConvertedDate)) <= 1) {
                    at = c.CreatedDate;
                }
                out.put(l.ConvertedContactId, at);
            }
        } catch (Exception e) {
            System.debug(LoggingLevel.WARN, 'Lead conversion lookup failed: ' + e.getMessage());
        }
        return out;
    }

    /** Open Opportunities the Contact has a Contact Role on (OpportunityContactRole, IsClosed = false), with the Project owner. */
    @AuraEnabled
    public static List<RelatedItem> getContactOpportunities(Id contactId) {
        List<RelatedItem> out = new List<RelatedItem>();
        if (contactId == null) {
            return out;
        }
        try {
            List<OpportunityContactRole> roles = (List<OpportunityContactRole>) Security.stripInaccessible(
                AccessType.READABLE,
                [SELECT OpportunityId, Opportunity.Name, Opportunity.StageName, Opportunity.RecordType.Name,
                        Opportunity.Owner.Name, Opportunity.Amount, Opportunity.CreatedDate, Opportunity.CloseDate,
                        Opportunity.Project_Name__c, Opportunity.Project_Name__r.Name, Opportunity.Project_Name__r.Owner.Name
                 FROM OpportunityContactRole
                 WHERE ContactId = :contactId AND Opportunity.IsClosed = false
                 ORDER BY Opportunity.CreatedDate DESC LIMIT 20]).getRecords();
            Set<Id> seen = new Set<Id>();
            for (OpportunityContactRole r : roles) {
                if (r.Opportunity == null || !seen.add(r.OpportunityId)) {
                    continue;
                }
                Opportunity o = r.Opportunity;
                RelatedItem i = new RelatedItem();
                i.recordId = r.OpportunityId;
                i.source = 'opportunity';
                i.name = o.Name;
                i.status = o.StageName;
                i.amount = o.Amount == null ? null : money(o.Amount);
                i.closeDate = o.CloseDate;
                i.createdDate = o.CreatedDate;
                i.owner = o.Owner == null ? null : o.Owner.Name;
                i.recordType = o.RecordType == null ? null : o.RecordType.Name;
                i.projectId = o.Project_Name__c;
                i.projectName = o.Project_Name__r == null ? null : o.Project_Name__r.Name;
                // canvas aabc (#96C/D): Project owner, for the "Split Territory" tag and the FETR row
                i.projectOwner = o.Project_Name__r == null || o.Project_Name__r.Owner == null ? null : o.Project_Name__r.Owner.Name;
                out.add(i);
            }
        } catch (Exception e) {
            System.debug(LoggingLevel.WARN, 'Contact opportunities not readable: ' + e.getMessage());
        }
        return out;
    }

    /** Matched Account: city/state/website and its 3 most recent Opportunities (plus total count). */
    @AuraEnabled
    public static AccountSummary getAccountSummary(Id accountId) {
        AccountSummary out = new AccountSummary();
        out.accountId = accountId;
        if (accountId == null) {
            return out;
        }
        try {
            List<Account> accts = (List<Account>) Security.stripInaccessible(AccessType.READABLE,
                [SELECT Id, BillingCity, BillingState, Website FROM Account WHERE Id = :accountId LIMIT 1]).getRecords();
            if (!accts.isEmpty()) {
                out.city = accts[0].BillingCity;
                out.state = accts[0].BillingState;
                out.website = accts[0].Website;
            }
            out.opportunityTotal = [SELECT COUNT() FROM Opportunity WHERE AccountId = :accountId];
            List<Opportunity> opps = (List<Opportunity>) Security.stripInaccessible(AccessType.READABLE,
                [SELECT Id, Name, StageName, Amount, CloseDate, CreatedDate FROM Opportunity
                 WHERE AccountId = :accountId ORDER BY CreatedDate DESC LIMIT 3]).getRecords();
            for (Opportunity o : opps) {
                RelatedItem i = new RelatedItem();
                i.recordId = o.Id;
                i.source = 'opportunity';
                i.name = o.Name;
                i.status = o.StageName;
                i.amount = o.Amount == null ? null : money(o.Amount);
                i.closeDate = o.CloseDate;
                i.createdDate = o.CreatedDate;
                out.opportunities.add(i);
            }
        } catch (Exception e) {
            System.debug(LoggingLevel.WARN, 'Account summary not readable: ' + e.getMessage());
        }
        return out;
    }

    /**
     * KBMax web quotes and website instant estimates linked to the Lead (Lead__c) or, on Contact rows, to the
     * Contact (Contact__c). The Contact__c filter is dynamic so the class compiles where that lookup is missing.
     */
    @AuraEnabled
    public static List<RelatedItem> getRelated(Id leadId, Id contactId, Id excludeId) {
        List<RelatedItem> out = new List<RelatedItem>();
        if (leadId == null && contactId == null) {
            return out;
        }
        String quoteFilter = relatedFilter('KBMax_Web_Quote__c', leadId, contactId);
        String estimateFilter = relatedFilter('Website_Instant_Estimate__c', leadId, contactId);
        // These two objects may not be visible to every LDR; skip quietly if not.
        try {
            List<KBMax_Web_Quote__c> quotes = quoteFilter == null ? new List<KBMax_Web_Quote__c>()
                : (List<KBMax_Web_Quote__c>) Security.stripInaccessible(AccessType.READABLE, Database.query(
                    'SELECT Id, Name, Project_Name__c, Product__c, Product_Type__c, Type_of_record__c, Type__c,'
                    + ' KBMax_Price__c, Status__c, CreatedDate FROM KBMax_Web_Quote__c WHERE ' + quoteFilter
                    + ' ORDER BY CreatedDate DESC LIMIT 20')).getRecords();
            for (KBMax_Web_Quote__c q : quotes) {
                RelatedItem i = new RelatedItem();
                i.recordId = q.Id;
                i.source = 'kbmax';
                i.kind = 'KBMax web quote';
                i.name = String.isBlank(q.Project_Name__c) ? q.Name : q.Project_Name__c;
                i.summary = joinNonBlank(new List<String>{ q.Product__c, q.Product_Type__c, q.Type_of_record__c, q.Type__c });
                i.amount = q.KBMax_Price__c == null ? null : money(q.KBMax_Price__c);
                i.status = q.Status__c;
                i.createdDate = q.CreatedDate;
                if (q.KBMax_Price__c != null && q.KBMax_Price__c == 0) {
                    i.note = 'KBMax price is $0, confirm pricing before quoting';
                }
                out.add(i);
            }
        } catch (Exception e) {
            System.debug(LoggingLevel.WARN, 'KBMax_Web_Quote__c not readable: ' + e.getMessage());
        }
        try {
            List<Website_Instant_Estimate__c> ests = estimateFilter == null ? new List<Website_Instant_Estimate__c>()
                : (List<Website_Instant_Estimate__c>) Security.stripInaccessible(AccessType.READABLE, Database.query(
                    'SELECT Id, Name, Frame_Type__c, Frame_Width__c, Frame_Height__c, Application__c,'
                    + ' Project_Classification__c, Estimate_Amount__c, CreatedDate FROM Website_Instant_Estimate__c WHERE '
                    + estimateFilter + ' ORDER BY CreatedDate DESC LIMIT 20')).getRecords();
            for (Website_Instant_Estimate__c w : ests) {
                if (w.Id == excludeId) {
                    continue; // the estimate being viewed is the queue item itself
                }
                RelatedItem i = new RelatedItem();
                i.recordId = w.Id;
                i.source = 'estimate';
                i.kind = 'Instant estimate';
                i.name = w.Name;
                String size = (String.isBlank(w.Frame_Width__c) && String.isBlank(w.Frame_Height__c)) ? null
                    : (w.Frame_Width__c == null ? '?' : w.Frame_Width__c) + ' W × ' + (w.Frame_Height__c == null ? '?' : w.Frame_Height__c) + ' H';
                i.summary = joinNonBlank(new List<String>{ w.Frame_Type__c, size, w.Application__c, w.Project_Classification__c });
                i.amount = w.Estimate_Amount__c;
                i.createdDate = w.CreatedDate;
                out.add(i);
            }
        } catch (Exception e) {
            System.debug(LoggingLevel.WARN, 'Website_Instant_Estimate__c not readable: ' + e.getMessage());
        }
        return out;
    }

    /** WHERE clause for KBMax / estimate lookups by Lead__c and/or Contact__c (only lookups that exist). */
    private static String relatedFilter(String objectName, Id leadId, Id contactId) {
        List<String> parts = new List<String>();
        if (leadId != null && hasField(objectName, 'Lead__c')) {
            parts.add('Lead__c = \'' + String.escapeSingleQuotes(String.valueOf(leadId)) + '\'');
        }
        if (contactId != null && hasField(objectName, 'Contact__c')) {
            parts.add('Contact__c = \'' + String.escapeSingleQuotes(String.valueOf(contactId)) + '\'');
        }
        return parts.isEmpty() ? null : '(' + String.join(parts, ' OR ') + ')';
    }

    /**
     * SELECT list for the queue's instant-estimate query: the estimate's own fields that exist in this org, the shared
     * Lead / Contact / claim fields, and the converted-Lead fields, with duplicates removed (SOQL rejects a field
     * selected twice; LINKED_RECORD_FIELDS already has Lead__r.IsConverted / ConvertedDate).
     */
    @TestVisible
    private static String estimateSelectList() {
        return dedupeFields(presentFields(ESTIMATE_OBJECT, ESTIMATE_FIELDS) + ', ' + LINKED_RECORD_FIELDS
            + ', Lead__r.IsConverted, Lead__r.ConvertedDate, Lead__r.ConvertedContactId');
    }

    /** "a, b, A, c" -> "a, b, c" (case-insensitive, first occurrence kept). */
    @TestVisible
    private static String dedupeFields(String fieldList) {
        Set<String> seen = new Set<String>();
        List<String> keep = new List<String>();
        for (String f : fieldList.split(',')) {
            String t = f.trim();
            if (t != '' && seen.add(t.toLowerCase())) {
                keep.add(t);
            }
        }
        return String.join(keep, ', ');
    }

    /**
     * The fields from a comma-separated list that exist on the object in this org (sandboxes refreshed before a
     * field was created don't have it; a dynamic query naming it would fail and show no estimates at all).
     */
    @TestVisible
    private static String presentFields(String objectName, String fieldList) {
        List<String> keep = new List<String>();
        for (String f : fieldList.split(',')) {
            String t = f.trim();
            if (t == 'Id' || hasField(objectName, t)) {
                keep.add(t);
            }
        }
        if (keep.isEmpty()) {
            keep.add('Id');
        }
        return String.join(keep, ', ');
    }

    /** A text value from a dynamically queried record, or null when the field wasn't queried / doesn't exist. */
    private static String textOf(SObject r, String field) {
        try {
            return r.isSet(field) && r.get(field) != null ? String.valueOf(r.get(field)) : null;
        } catch (Exception e) {
            return null;
        }
    }

    private static Boolean hasField(String objectName, String fieldName) {
        Map<String, Schema.SObjectField> fields = fieldMap(objectName);
        return fields != null && fields.containsKey(fieldName.toLowerCase());
    }

    /** Lower-case object name -> its field map (null when the object doesn't exist), cached for the transaction. */
    private static Map<String, Map<String, Schema.SObjectField>> fieldMaps = new Map<String, Map<String, Schema.SObjectField>>();

    /**
     * The object's field map, or null when the object doesn't exist in this org. One global describe + field describe
     * per object per transaction (hasField runs 100+ times per getQueue); metadata can't change mid-transaction.
     */
    private static Map<String, Schema.SObjectField> fieldMap(String objectName) {
        String key = objectName.toLowerCase();
        if (!fieldMaps.containsKey(key)) {
            Schema.SObjectType t = Schema.getGlobalDescribe().get(key);
            fieldMaps.put(key, t == null ? null : t.getDescribe().fields.getMap());
        }
        return fieldMaps.get(key);
    }

    /**
     * Every other Form Submission from the same email address (any Lead), including
     * Representative requests, so the inbox can show "other submissions from this person"
     * and flag a recent rep request.
     */
    @AuraEnabled
    public static List<PersonSubmission> getPersonSubmissions(String email, Id excludeSubmissionId) {
        List<PersonSubmission> out = new List<PersonSubmission>();
        if (String.isBlank(email)) {
            return out;
        }
        List<Form_Submission__c> rows = (List<Form_Submission__c>) Security.stripInaccessible(AccessType.READABLE,
            [SELECT Id, Inquiry_Type__c, Claimed_By__c, Claimed_By__r.Name, Lead__c, Submit_Time__c, CreatedDate,
                    Project_Name__c, Questions_or_Comments__c, Comments__c
             FROM Form_Submission__c
             WHERE Email_Address__c = :email AND Id != :excludeSubmissionId
             ORDER BY CreatedDate DESC LIMIT 20]).getRecords();
        for (Form_Submission__c f : rows) {
            PersonSubmission p = new PersonSubmission();
            p.recordId = f.Id;
            p.inquiryType = f.Inquiry_Type__c;
            p.claimedById = f.Claimed_By__c;
            p.claimedByName = f.Claimed_By__r == null ? null : f.Claimed_By__r.Name;
            p.leadId = f.Lead__c;
            p.submittedAt = f.Submit_Time__c != null ? f.Submit_Time__c : f.CreatedDate;
            p.projectName = f.Project_Name__c;
            p.comments = String.isNotBlank(f.Questions_or_Comments__c) ? stripInternalTags(f.Questions_or_Comments__c) : stripInternalTags(f.Comments__c);
            out.add(p);
        }
        // Custom instant estimates from the same email (the ones the queue shows), when they can be claimed.
        if (estimatesClaimable()) {
            try {
                Map<String, Object> binds = new Map<String, Object>{
                    'amounts' => QUEUE_ESTIMATE_AMOUNTS, 'email' => email, 'excludeId' => excludeSubmissionId
                };
                for (SObject e : Security.stripInaccessible(AccessType.READABLE, Database.queryWithBinds(
                        'SELECT Id, Claimed_By__c, Claimed_By__r.Name, Lead__c, CreatedDate, '
                        + presentFields(ESTIMATE_OBJECT, 'Frame_Type__c, Frame_Width__c, Frame_Height__c, Questions_or_Comments__c')
                        + ' FROM ' + ESTIMATE_OBJECT
                        + ' WHERE Email_Address__c = :email AND Id != :excludeId AND Estimate_Amount__c IN :amounts'
                        + ' AND ' + estimateWindowClause(binds) + ' ORDER BY CreatedDate DESC LIMIT 20',
                        binds, AccessLevel.SYSTEM_MODE)).getRecords()) {
                    PersonSubmission p = new PersonSubmission();
                    p.recordId = e.Id;
                    p.inquiryType = 'Instant Estimate';
                    p.claimedById = (Id) e.get('Claimed_By__c');
                    SObject cb = e.getSObject('Claimed_By__r');
                    p.claimedByName = cb == null ? null : (String) cb.get('Name');
                    p.leadId = (Id) e.get('Lead__c');
                    p.submittedAt = (Datetime) e.get('CreatedDate');
                    p.projectName = 'Custom estimate · ' + joinNonBlank(new List<String>{
                        textOf(e, 'Frame_Type__c'), textOf(e, 'Frame_Width__c'), textOf(e, 'Frame_Height__c') });
                    p.comments = stripInternalTags(textOf(e, 'Questions_or_Comments__c'));
                    out.add(p);
                }
            } catch (Exception ex) {
                System.debug(LoggingLevel.WARN, 'Instant estimates not readable: ' + ex.getMessage());
            }
        }
        return out;
    }

    // ---------------------------------------------------------------- Writes

    /**
     * Claims a submission for the running user. The submission row is locked (FOR UPDATE) so two
     * LDRs clicking at the same moment cannot both win; the loser gets CONFLICT:<winner>.
     * The linked Lead or Contact also: takes over Project_Coordinator__c (even if someone else had it),
     * gets Lead_Funnel_Time_Stamp__c = today, and has a stale (or, on a Contact, blank) status reset to New.
     * When the status is New after the claim (reset or already New), Lead_Funnel_Outcome__c is cleared (#153 A).
     * The previous coordinator / timestamp are recoverable from field history, which Release uses.
     */
    @AuraEnabled
    public static Integer claim(Id submissionId) {
        Id me = UserInfo.getUserId();
        Savepoint sp = Database.setSavepoint();
        try {
            Item sub = lockItem(submissionId);
            if (sub.claimedBy != null && sub.claimedBy != me) {
                throw auraError(CONFLICT_PREFIX + claimerName(sub.claimedBy));
            }
            sub.setClaim(me);
            Database.update(sub.upd, AccessLevel.USER_MODE);

            if (isLinked(sub)) { // not linked yet: only the submission is claimed
                SObject rec = readRecord(sub);
                SObject upd = blankRecord(sub);
                upd.put('Project_Coordinator__c', me);
                upd.put('Lead_Funnel_Time_Stamp__c', Date.today());
                String st = (String) rec.get(statusField(sub));
                if (CLAIM_RESETS_STATUS.contains(st) || isRetiredStatus(String.valueOf(rec.getSObjectType()), statusField(sub), st)
                        || (sub.leadId == null && String.isBlank(st))) {
                    // stale/exited or retired status (or a blank Contact Lead Funnel Status): the new submission is a re-engagement
                    upd.put(statusField(sub), 'New');
                    st = 'New';
                }
                if (st == 'New') {
                    // canvas #152 B / #153 A: a record that is New after the claim starts with no Lead Funnel Outcome
                    upd.put('Lead_Funnel_Outcome__c', null);
                }
                Database.update(upd, AccessLevel.USER_MODE);
            }
            return claimSiblings(sub, me);
        } catch (AuraHandledException e) {
            Database.rollback(sp);
            throw e;
        } catch (Exception e) {
            Database.rollback(sp);
            throw auraError('Claim failed: ' + e.getMessage());
        }
    }

    /**
     * Also claims this person's other UNCLAIMED queue items, form submissions and Custom instant estimates alike:
     * same Lead, same Contact, or (when nothing is linked) same email with nothing linked either. Representative
     * requests are skipped. The Lead/Contact itself was already updated by the claim. Returns how many were claimed.
     */
    @TestVisible
    private static Integer claimSiblings(Item sub, Id me) {
        Map<String, Object> binds = new Map<String, Object>{
            'selfId' => sub.id, 'excluded' => EXCLUDED_INQUIRIES, 'leadId' => sub.leadId,
            'contactId' => sub.contactId, 'convLeadId' => sub.convertedLeadId, 'email' => sub.email
        };
        String match;
        if (sub.leadId != null) {
            match = 'Lead__c = :leadId';
        } else if (sub.contactId != null) {
            // the Contact, or submissions still pointing at the Lead that became it
            match = sub.convertedLeadId != null ? '(Contact__c = :contactId OR Lead__c = :convLeadId)' : 'Contact__c = :contactId';
        } else if (String.isNotBlank(sub.email)) {
            match = 'Email_Address__c = :email AND Lead__c = null AND Contact__c = null';
        } else {
            return 0;
        }
        Integer count = 0;
        List<SObject> forms = Database.queryWithBinds(
            'SELECT Id, Contact__c FROM Form_Submission__c WHERE ' + match + ' AND Id != :selfId AND Claimed_By__c = null'
            + ' AND (Inquiry_Type__c = null OR Inquiry_Type__c NOT IN :excluded) LIMIT 50 FOR UPDATE',
            binds, AccessLevel.USER_MODE);
        count += claimRows(forms, me, sub.contactId);
        if (estimatesClaimable()) {
            binds.put('amounts', QUEUE_ESTIMATE_AMOUNTS);
            List<SObject> ests = Database.queryWithBinds(
                'SELECT Id, Contact__c FROM ' + ESTIMATE_OBJECT + ' WHERE ' + match + ' AND Id != :selfId AND Claimed_By__c = null'
                + ' AND Estimate_Amount__c IN :amounts AND ' + estimateWindowClause(binds) + ' LIMIT 50 FOR UPDATE',
                binds, AccessLevel.USER_MODE);
            count += claimRows(ests, me, sub.contactId);
        }
        return count;
    }

    /** Sets the claim on sibling rows (clean update records); links Contact__c when it was only reachable via the Lead. */
    private static Integer claimRows(List<SObject> rows, Id me, Id contactId) {
        Datetime at = Datetime.now();
        List<SObject> upds = new List<SObject>();
        for (SObject r : rows) {
            SObject u = r.getSObjectType().newSObject(r.Id);
            u.put('Claimed_By__c', me);
            u.put(CLAIMED_AT, at);
            if (contactId != null && r.get('Contact__c') == null) {
                u.put('Contact__c', contactId);
                u.put('Lead__c', null);
            }
            upds.add(u);
        }
        if (!upds.isEmpty()) {
            Database.update(upds, AccessLevel.USER_MODE);
        }
        return upds.size();
    }

    /**
     * Reassign (Mine): gives a claim back to the Project Coordinator it replaced. Project Coordinator and Lead
     * Funnel Timestamp go back to their pre-claim values (from field history), and Claimed_By__c / ClaimedDate__c
     * move to that person, so it lands in their Mine tab. Contact.Lead_Funnel_Time_Stamp__c has no field history,
     * so on a Contact the timestamp is left as is. Returns the name it was reassigned to.
     */
    @AuraEnabled
    public static String reassign(Id submissionId) {
        Id me = UserInfo.getUserId();
        Savepoint sp = Database.setSavepoint();
        try {
            Item sub = lockItem(submissionId);
            requireMine(sub, me);
            requireLinked(sub);
            ClaimContext ctx = claimContextFor(sub, me);
            if (!ctx.canReassign) {
                throw auraError('Nobody else was Project Coordinator before your claim, so there is no one to reassign it to.');
            }
            sub.setClaim(ctx.previousCoordinatorId);
            Database.update(sub.upd, AccessLevel.USER_MODE);
            SObject upd = blankRecord(sub);
            upd.put('Project_Coordinator__c', ctx.previousCoordinatorId);
            if (ctx.funnelTsChangedByClaim) {
                upd.put('Lead_Funnel_Time_Stamp__c', ctx.previousFunnelTs);
            }
            Database.update(upd, AccessLevel.USER_MODE);
            return ctx.previousCoordinatorName != null ? ctx.previousCoordinatorName : claimerName(ctx.previousCoordinatorId);
        } catch (AuraHandledException e) {
            Database.rollback(sp);
            throw e;
        } catch (Exception e) {
            Database.rollback(sp);
            throw auraError('Reassign failed: ' + e.getMessage());
        }
    }

    /**
     * Claim from a teammate (Team tab): takes over another LDR's claim. Project Coordinator = me, Lead Funnel
     * Timestamp = today, Claimed_By__c = me, ClaimedDate__c = now. The previous values stay in field history,
     * so Reassign can give it back. expectedClaimerId guards against a change since the page loaded.
     */
    @AuraEnabled
    public static void claimFrom(Id submissionId, Id expectedClaimerId) {
        Id me = UserInfo.getUserId();
        Savepoint sp = Database.setSavepoint();
        try {
            Item sub = lockItem(submissionId);
            if (sub.claimedBy == null || sub.claimedBy == me) {
                throw auraError('This submission is no longer claimed by someone else. Refresh the inbox.');
            }
            // The stale-claim check is required: a null expectedClaimerId used to skip it and take over any claim.
            if (expectedClaimerId == null || sub.claimedBy != expectedClaimerId) {
                throw auraError(CONFLICT_PREFIX + claimerName(sub.claimedBy));
            }
            sub.setClaim(me);
            Database.update(sub.upd, AccessLevel.USER_MODE);
            if (isLinked(sub)) {
                SObject upd = blankRecord(sub);
                upd.put('Project_Coordinator__c', me);
                upd.put('Lead_Funnel_Time_Stamp__c', Date.today());
                Database.update(upd, AccessLevel.USER_MODE);
            }
        } catch (AuraHandledException e) {
            Database.rollback(sp);
            throw e;
        } catch (Exception e) {
            Database.rollback(sp);
            throw auraError('Claim failed: ' + e.getMessage());
        }
    }

    /**
     * The inbox's own Create Lead form (unlinked submissions). Inserts the Lead in USER_MODE (validation and
     * duplicate rules apply), links it to the submission (Lead__c) and, when the submission is already claimed,
     * sets Project Coordinator = the claimer and Lead Funnel Timestamp = today. Returns the new Lead Id.
     */
    @AuraEnabled
    public static Id createLeadForSubmission(Id submissionId, Map<String, String> fields) {
        Savepoint sp = Database.setSavepoint();
        try {
            Item sub = lockItem(submissionId);
            if (isLinked(sub)) {
                throw auraError('This submission is already linked to a Lead or Contact. Click Refresh.');
            }
            Lead l = new Lead();
            for (String f : (fields == null ? new Map<String, String>() : fields).keySet()) {
                if (!CREATE_LEAD_FIELDS.contains(f)) {
                    throw auraError('Field not allowed from the LDR Inbox: ' + f);
                }
                String v = fields.get(f);
                if (String.isNotBlank(v)) {
                    l.put(f, v.trim());
                }
            }
            if (sub.claimedBy != null) {
                l.Project_Coordinator__c = sub.claimedBy;
                l.Lead_Funnel_Time_Stamp__c = Date.today();
            }
            Database.insert(l, AccessLevel.USER_MODE);
            sub.upd.put('Lead__c', l.Id);
            Database.update(sub.upd, AccessLevel.USER_MODE);
            return l.Id;
        } catch (AuraHandledException e) {
            Database.rollback(sp);
            throw e;
        } catch (DmlException e) {
            Database.rollback(sp);
            String msg = e.getDmlMessage(0);
            if (e.getDmlType(0) == StatusCode.DUPLICATES_DETECTED) {
                msg = 'Salesforce found a matching Lead or Contact (duplicate rule), so no Lead was created. Use "Link to existing" instead. Details: ' + msg;
            }
            throw auraError('Create Lead failed: ' + msg);
        } catch (Exception e) {
            Database.rollback(sp);
            throw auraError('Create Lead failed: ' + e.getMessage());
        }
    }

    /** A suggested Lead / Contact for "Link to existing" (canvas 7c73). */
    public class LinkSuggestion {
        @AuraEnabled public Id id;
        @AuraEnabled public String kind;   // 'Lead' | 'Contact'
        @AuraEnabled public String name;
        @AuraEnabled public String sub;    // email / company or account
        @AuraEnabled public String why;    // 'Same email' | 'Same name'
    }

    /**
     * Up to 4 unconverted Leads / Contacts with the submission's email, or the given name (user mode, so only
     * records the LDR can see). Contacts are listed first: a Contact is the record the inbox works when both exist.
     */
    @AuraEnabled
    public static List<LinkSuggestion> getLinkSuggestions(Id submissionId, String name) {
        Item sub = readItem(submissionId);
        String email = String.isBlank(sub.email) ? null : sub.email.trim();
        String nm = String.isBlank(name) ? null : name.trim();
        List<LinkSuggestion> out = new List<LinkSuggestion>();
        if (email == null && nm == null) {
            return out;
        }
        for (Contact c : [
            SELECT Id, Name, Email, Account.Name FROM Contact
            WHERE (Email = :email AND Email != null) OR (Name = :nm AND Name != null)
            WITH USER_MODE ORDER BY LastModifiedDate DESC LIMIT 4
        ]) {
            out.add(suggestion(c.Id, 'Contact', c.Name, c.Email, c.Account == null ? null : c.Account.Name, email));
        }
        for (Lead l : [
            SELECT Id, Name, Email, Company FROM Lead
            WHERE IsConverted = false AND ((Email = :email AND Email != null) OR (Name = :nm AND Name != null))
            WITH USER_MODE ORDER BY LastModifiedDate DESC LIMIT 4
        ]) {
            out.add(suggestion(l.Id, 'Lead', l.Name, l.Email, l.Company, email));
        }
        while (out.size() > 4) {
            out.remove(out.size() - 1);
        }
        return out;
    }

    private static LinkSuggestion suggestion(Id id, String kind, String name, String recEmail, String org, String email) {
        LinkSuggestion s = new LinkSuggestion();
        s.id = id;
        s.kind = kind;
        s.name = name;
        s.sub = joinNonBlank(new List<String>{ recEmail, org });
        s.why = (email != null && recEmail != null && recEmail.equalsIgnoreCase(email)) ? 'Same email' : 'Same name';
        return s;
    }

    /**
     * "Link to existing": sets Lead__c and/or Contact__c on an unlinked submission (user mode, so the LDR's own
     * field access applies, same as Create Lead). A converted Lead is refused; link its Contact instead.
     */
    @AuraEnabled
    public static void linkSubmission(Id submissionId, Id leadId, Id contactId) {
        if (leadId == null && contactId == null) {
            throw auraError('Pick a Lead or a Contact to link.');
        }
        if (leadId != null && leadId.getSObjectType() != Lead.SObjectType) {
            throw auraError('That isn\'t a Lead.');
        }
        if (contactId != null && contactId.getSObjectType() != Contact.SObjectType) {
            throw auraError('That isn\'t a Contact.');
        }
        Savepoint sp = Database.setSavepoint();
        try {
            Item sub = lockItem(submissionId);
            if (isLinked(sub)) {
                throw auraError('This submission is already linked to a Lead or Contact. Click Refresh.');
            }
            if (leadId != null) {
                List<Lead> ls = [SELECT Id, IsConverted FROM Lead WHERE Id = :leadId WITH USER_MODE LIMIT 1];
                if (ls.isEmpty()) {
                    throw auraError('Lead not found or not visible to you.');
                }
                if (ls[0].IsConverted) {
                    throw auraError('That Lead is already converted. Link its Contact instead.');
                }
                sub.upd.put('Lead__c', leadId);
            }
            if (contactId != null) {
                if ([SELECT COUNT() FROM Contact WHERE Id = :contactId WITH USER_MODE] == 0) {
                    throw auraError('Contact not found or not visible to you.');
                }
                sub.upd.put('Contact__c', contactId);
            }
            Database.update(sub.upd, AccessLevel.USER_MODE);
        } catch (AuraHandledException e) {
            Database.rollback(sp);
            throw e;
        } catch (Exception e) {
            Database.rollback(sp);
            throw auraError('Link failed: ' + e.getMessage());
        }
    }

    /**
     * Assigns an unclaimed submission to the Lead's existing Project Coordinator
     * (instead of the running user). Sets Claimed_By__c to that coordinator and
     * Status New -> Working. No notification is sent.
     */
    @AuraEnabled
    public static void assignToCoordinator(Id submissionId) {
        Savepoint sp = Database.setSavepoint();
        try {
            Item sub = lockItem(submissionId);
            if (sub.claimedBy != null) {
                throw auraError(CONFLICT_PREFIX + claimerName(sub.claimedBy));
            }
            requireLinked(sub);
            SObject rec = readRecord(sub);
            Id coordinator = (Id) rec.get('Project_Coordinator__c');
            if (coordinator == null) {
                throw auraError('This record has no Project Coordinator to assign to.');
            }
            sub.setClaim(coordinator);
            Database.update(sub.upd, AccessLevel.USER_MODE);
            if ((String) rec.get(statusField(sub)) == 'New') {
                SObject upd = blankRecord(sub);
                upd.put(statusField(sub), 'Working');
                Database.update(upd, AccessLevel.USER_MODE);
            }
        } catch (AuraHandledException e) {
            Database.rollback(sp);
            throw e;
        } catch (Exception e) {
            Database.rollback(sp);
            throw auraError('Assign failed: ' + e.getMessage());
        }
    }

    /**
     * Releases a submission the running user holds. Restores the Project Coordinator and Lead Funnel
     * Timestamp the Lead or Contact had before this claim (from field history), and moves status Working -> New.
     */
    @AuraEnabled
    public static void release(Id submissionId) {
        Id me = UserInfo.getUserId();
        Savepoint sp = Database.setSavepoint();
        try {
            Item sub = lockItem(submissionId);
            requireMine(sub, me);
            Boolean linked = isLinked(sub);
            ClaimContext ctx = linked ? claimContextFor(sub, me) : null;

            sub.setClaim(null);
            if (!linked) {
                clearStatusTags(sub); // v6g7: back to Unclaimed without its #Working / #Unreachable / #Disqualified
            }
            Database.update(sub.upd, AccessLevel.USER_MODE);
            if (!linked) {
                return; // nothing on a Lead/Contact to restore
            }

            SObject rec = readRecord(sub);
            SObject upd = blankRecord(sub);
            if (ctx.coordinatorChangedByClaim) {
                upd.put('Project_Coordinator__c', ctx.previousCoordinatorId);
            } else if (ctx.noHistory && (Id) rec.get('Project_Coordinator__c') == me) {
                upd.put('Project_Coordinator__c', null); // no history to restore from: assume it was blank
            }
            if (ctx.funnelTsChangedByClaim) {
                upd.put('Lead_Funnel_Time_Stamp__c', ctx.previousFunnelTs);
            } else if (ctx.noHistory && sub.leadId != null && (Date) rec.get('Lead_Funnel_Time_Stamp__c') == Date.today()) {
                // Lead only: Contact.Lead_Funnel_Time_Stamp__c has no field history in production, so on a
                // Contact we can't tell what it was before the claim and leave it as is.
                upd.put('Lead_Funnel_Time_Stamp__c', null);
            }
            if ((String) rec.get(statusField(sub)) == 'Working') {
                upd.put(statusField(sub), 'New');
            }
            Database.update(upd, AccessLevel.USER_MODE);
        } catch (AuraHandledException e) {
            Database.rollback(sp);
            throw e;
        } catch (Exception e) {
            Database.rollback(sp);
            throw auraError('Release failed: ' + e.getMessage());
        }
    }

    /** What the running user's claim changed on the Lead (for the "took over from" reminder). */
    @AuraEnabled
    public static ClaimContext getClaimContext(Id submissionId) {
        Id me = UserInfo.getUserId();
        Item sub = readItem(submissionId);
        if (sub.claimedBy != me || !isLinked(sub)) {
            return new ClaimContext();
        }
        return claimContextFor(sub, me);
    }

    /** Saves the LDR fields on the Lead / Contact. Only the claimer may save. */
    @AuraEnabled
    public static void saveLeadFields(Id submissionId, String status, String outcome,
                                      String ldrProjectName, String ldrNotes, Map<String, String> preConversion) {
        // Admins may also save an UNCLAIMED submission's fields without claiming it, and (v7, Aqil) one claimed by
        // another LDR (the All tab).
        writeLeadFields(submissionId, status, outcome, ldrProjectName, ldrNotes, preConversion, isAdmin());
    }

    /**
     * Follow Up Information: saves 6Sense Option (X6Sense_Option__c) on the Lead / Contact on its own.
     * Same rule as the LDR fields: the claimer, or an admin on an unclaimed item.
     */
    @AuraEnabled
    public static void saveSixSense(Id submissionId, String value) {
        Id me = UserInfo.getUserId();
        try {
            Item sub = readItem(submissionId);
            if (!(isAdmin() && sub.claimedBy == null)) {
                requireMine(sub, me);
            }
            requireLinked(sub);
            SObject upd = blankRecord(sub);
            if (!hasField(String.valueOf(upd.getSObjectType()), SIX_SENSE_FIELD)) {
                throw auraError('6Sense Option (X6Sense_Option__c) doesn\'t exist on this object in this org.');
            }
            upd.put(SIX_SENSE_FIELD, String.isBlank(value) ? null : value);
            Database.update(upd, AccessLevel.USER_MODE);
        } catch (AuraHandledException e) {
            throw e;
        } catch (Exception e) {
            throw auraError('Save failed: ' + e.getMessage());
        }
    }

    /**
     * Status (and Lead Funnel Outcome) only, without claiming: allowed on a Contact-linked submission whose Lead
     * was converted after the form came in, so the LDR can close it out (anything but New/Working removes it).
     * Not allowed when another LDR holds the claim.
     */
    @AuraEnabled
    public static void saveStatusWithoutClaim(Id submissionId, String status, String outcome) {
        Id me = UserInfo.getUserId();
        try {
            Item sub = readItem(submissionId);
            if (sub.claimedBy != null && sub.claimedBy != me) {
                throw auraError('Someone else has claimed this submission.');
            }
            if (sub.leadId != null || sub.contactId == null) {
                throw auraError('Claim this lead first. Only the LDR who claimed it can change it.');
            }
            Datetime convertedAt = convertedAtFor(new Set<Id>{ sub.contactId }).get(sub.contactId);
            Datetime submittedAt = sub.submittedAt;
            if (convertedAt == null || convertedAt <= submittedAt) {
                throw auraError('Claim this contact first. Status can only be changed without claiming when the Lead was converted after the form came in.');
            }
            Contact upd = new Contact(Id = sub.contactId, Lead_Funnel_Status__c = String.isBlank(status) ? null : status);
            if (String.isNotBlank(outcome)) {
                upd.Lead_Funnel_Outcome__c = outcome;
            }
            Database.update(upd, AccessLevel.USER_MODE);
        } catch (AuraHandledException e) {
            throw e;
        } catch (Exception e) {
            throw auraError('Save failed: ' + e.getMessage());
        }
    }

    /** Saves the LDR fields and marks the Lead (or Contact) Qualified / Hand-off to Rep. */
    @AuraEnabled
    public static void handoff(Id submissionId, String ldrProjectName, String ldrNotes,
                               Map<String, String> preConversion) {
        writeLeadFields(submissionId, 'Qualified', 'Hand-off to Rep', ldrProjectName, ldrNotes, preConversion, false);
    }

    /** Result of getLeadConversion: whether the Lead is converted, and what it became. */
    public class LeadConversion {
        @AuraEnabled public Boolean isConverted = false;
        @AuraEnabled public Id contactId;
        @AuraEnabled public Id opportunityId;
        @AuraEnabled public String opportunityName;
    }

    /**
     * Canvas #129: the inbox checks this while the Convert Lead - LDR flow runs, so it can replace the flow's own
     * summary screen with its Files step as soon as the Lead is converted. Not cacheable, so every call reads the
     * current state. flowOpportunityId (optional): the flow's OpportunityId output (v5, Zaid's flow update); when
     * given it wins over the Lead's ConvertedOpportunityId. Otherwise, if the flow made the Opportunity itself
     * (ConvertedOpportunityId blank), falls back to the Contact's newest open Opportunity from the last 10 minutes.
     */
    @AuraEnabled
    public static LeadConversion getLeadConversion(Id leadId, Id flowOpportunityId) {
        LeadConversion out = new LeadConversion();
        if (leadId == null) {
            return out;
        }
        List<Lead> ls = [
            SELECT IsConverted, ConvertedContactId, ConvertedOpportunityId, ConvertedOpportunity.Name
            FROM Lead WHERE Id = :leadId WITH USER_MODE LIMIT 1
        ];
        if (ls.isEmpty() || !ls[0].IsConverted) {
            return out;
        }
        out.isConverted = true;
        out.contactId = ls[0].ConvertedContactId;
        out.opportunityId = ls[0].ConvertedOpportunityId;
        out.opportunityName = ls[0].ConvertedOpportunity?.Name;
        if (flowOpportunityId != null && flowOpportunityId != out.opportunityId) {
            for (Opportunity o : [SELECT Name FROM Opportunity WHERE Id = :flowOpportunityId WITH USER_MODE LIMIT 1]) {
                out.opportunityId = o.Id;
                out.opportunityName = o.Name;
            }
        }
        if (out.opportunityId == null && out.contactId != null) {
            Id cid = out.contactId;
            Datetime since = Datetime.now().addMinutes(-10);
            for (OpportunityContactRole r : [
                SELECT OpportunityId, Opportunity.Name FROM OpportunityContactRole
                WHERE ContactId = :cid AND Opportunity.IsClosed = false AND Opportunity.CreatedDate >= :since
                WITH USER_MODE ORDER BY Opportunity.CreatedDate DESC LIMIT 1
            ]) {
                out.opportunityId = r.OpportunityId;
                out.opportunityName = r.Opportunity.Name;
            }
        }
        return out;
    }

    // ---------------------------------------------------------------- KBMax quotes on the new Opportunity (Aqil, 2026-10-30)

    @TestVisible static final String KBMAX_JUNCTION = 'KBMax_Web_Quote_Junction__c';
    /** Quotes older than this aren't offered. */
    @TestVisible static final Integer KBMAX_LINK_DAYS = 365;

    /** A KBMax web quote the LDR can link to the new Opportunity (Convert / Attach to Opportunity files step). */
    public class KbmaxQuote {
        @AuraEnabled public Id id;
        @AuraEnabled public String name;
        @AuraEnabled public String project;
        @AuraEnabled public String product;
        @AuraEnabled public Decimal price;
        @AuraEnabled public Datetime createdDate;
        /** Already has a KBMax Web Quote Junction on this Opportunity. */
        @AuraEnabled public Boolean linked = false;
    }

    /**
     * The person's KBMax web quotes from the last year, newest first: on the Lead, on the Contact, or on a Lead that was
     * converted into the Contact. linked = already joined to opportunityId. User mode; empty when the objects don't exist.
     */
    @AuraEnabled
    public static List<KbmaxQuote> getKbmaxQuotes(Id leadId, Id contactId, Id opportunityId) {
        List<KbmaxQuote> out = new List<KbmaxQuote>();
        if (!hasField(KBMAX_OBJECT, 'Lead__c') || !hasField(KBMAX_OBJECT, 'Contact__c') || (leadId == null && contactId == null)) {
            return out;
        }
        try {
            Set<Id> leadIds = new Set<Id>();
            if (leadId != null) {
                leadIds.add(leadId);
            }
            if (contactId != null) {
                for (Lead l : [SELECT Id FROM Lead WHERE IsConverted = true AND ConvertedContactId = :contactId WITH USER_MODE LIMIT 50]) {
                    leadIds.add(l.Id);
                }
            }
            List<String> who = new List<String>();
            if (!leadIds.isEmpty()) {
                who.add('Lead__c IN :leads');
            }
            if (contactId != null) {
                who.add('Contact__c = :cid');
            }
            String fields = presentPaths(KBMAX_OBJECT, new List<String>{ 'Id', 'Name', 'Project_Name__c', 'Product__c', 'KBMax_Price__c', 'CreatedDate' });
            Map<String, Object> binds = new Map<String, Object>{
                'leads' => leadIds, 'cid' => contactId, 'since' => Datetime.now().addDays(-KBMAX_LINK_DAYS)
            };
            for (SObject q : Database.queryWithBinds('SELECT ' + fields + ' FROM ' + KBMAX_OBJECT + ' WHERE (' + String.join(who, ' OR ')
                    + ') AND CreatedDate >= :since ORDER BY CreatedDate DESC LIMIT 100', binds, AccessLevel.USER_MODE)) {
                KbmaxQuote k = new KbmaxQuote();
                k.id = q.Id;
                k.name = textOf(q, 'Name');
                k.project = textOf(q, 'Project_Name__c');
                k.product = textOf(q, 'Product__c');
                k.price = (Decimal) pathValue(q, 'KBMax_Price__c');
                k.createdDate = (Datetime) pathValue(q, 'CreatedDate');
                out.add(k);
            }
            if (opportunityId != null && !out.isEmpty() && fieldMap(KBMAX_JUNCTION) != null) {
                Map<Id, KbmaxQuote> byId = new Map<Id, KbmaxQuote>();
                for (KbmaxQuote k : out) {
                    byId.put(k.id, k);
                }
                for (Id q : linkedQuoteIds(opportunityId, byId.keySet())) {
                    byId.get(q).linked = true;
                }
            }
        } catch (Exception e) {
            throw auraError('Couldn\'t read the KBMax web quotes: ' + e.getMessage());
        }
        return out;
    }

    /** Of these quotes, the ones already joined to the Opportunity (KBMax Web Quote Junction). */
    private static Set<Id> linkedQuoteIds(Id opportunityId, Set<Id> quoteIds) {
        Set<Id> out = new Set<Id>();
        for (SObject j : Database.queryWithBinds('SELECT KBMax_Web_Quote__c FROM ' + KBMAX_JUNCTION
                + ' WHERE Opportunity__c = :opp AND KBMax_Web_Quote__c IN :ids',
                new Map<String, Object>{ 'opp' => opportunityId, 'ids' => quoteIds }, AccessLevel.USER_MODE)) {
            out.add((Id) j.get('KBMax_Web_Quote__c'));
        }
        return out;
    }

    /**
     * A checked quote: adds a KBMax Web Quote Junction (Opportunity__c + KBMax_Web_Quote__c, as the Contact page's flow
     * does) for each quote not already joined to the Opportunity. User mode (needs Create on the junction: LDR Inbox
     * User permission set). Returns how many were added.
     */
    @AuraEnabled
    public static Integer linkKbmaxQuotes(Id opportunityId, List<Id> quoteIds) {
        if (opportunityId == null || quoteIds == null || quoteIds.isEmpty()) {
            return 0;
        }
        if (fieldMap(KBMAX_JUNCTION) == null) {
            throw auraError('KBMax Web Quote Junction doesn\'t exist in this org.');
        }
        try {
            Set<Id> todo = new Set<Id>(quoteIds);
            todo.removeAll(linkedQuoteIds(opportunityId, todo));
            List<SObject> rows = new List<SObject>();
            for (Id q : todo) {
                SObject j = Schema.getGlobalDescribe().get(KBMAX_JUNCTION).newSObject();
                j.put('Opportunity__c', opportunityId);
                j.put('KBMax_Web_Quote__c', q);
                rows.add(j);
            }
            if (!rows.isEmpty()) {
                Database.insert(rows, AccessLevel.USER_MODE);
            }
            return rows.size();
        } catch (Exception e) {
            throw auraError('Couldn\'t add the KBMax quote to the Opportunity: ' + e.getMessage());
        }
    }

    /**
     * Canvas #150: once the Convert window sees the Lead converted, the new Contact's Lead Funnel Status is set to
     * Qualified, only while it is blank (as a new Contact's is; a Contact the Lead was merged into keeps its status).
     * Runs once per conversion (the LWC calls it when it moves to the Files step), in user mode: LDRs already set this
     * field with the status buttons. Returns whether it changed; a Lead that isn't converted writes nothing.
     * Conversions outside the inbox (the Lead page's Convert button, other flows) aren't covered.
     */
    @AuraEnabled
    public static Boolean qualifyConvertedContact(Id leadId) {
        if (leadId == null) {
            return false;
        }
        try {
            List<Lead> ls = [
                SELECT IsConverted, ConvertedContactId FROM Lead WHERE Id = :leadId WITH USER_MODE LIMIT 1
            ];
            if (ls.isEmpty() || !ls[0].IsConverted || ls[0].ConvertedContactId == null) {
                return false;
            }
            Id cid = ls[0].ConvertedContactId;
            List<Contact> cs = [SELECT Lead_Funnel_Status__c FROM Contact WHERE Id = :cid WITH USER_MODE LIMIT 1];
            if (cs.isEmpty() || String.isNotBlank(cs[0].Lead_Funnel_Status__c)) {
                return false;
            }
            Database.update(new Contact(Id = cid, Lead_Funnel_Status__c = 'Qualified'), AccessLevel.USER_MODE);
            return true;
        } catch (Exception e) {
            throw auraError('Couldn\'t set Lead Funnel Status to Qualified: ' + e.getMessage());
        }
    }

    /**
     * Lead History (field changes, geocode/Data.com noise and ID rows removed, only fields the
     * user can read) and Activity History (Tasks on the Lead, Eloqua tracking noise removed).
     */
    @AuraEnabled
    public static LeadTimeline getLeadTimeline(Id leadId) {
        LeadTimeline t = new LeadTimeline();
        if (leadId == null) {
            return t;
        }
        // Works for a Lead or a Contact Id (Contact-linked submissions show Contact History).
        Boolean isContact = leadId.getSObjectType() == Contact.SObjectType;
        Map<String, Schema.SObjectField> leadFields = isContact
            ? Schema.SObjectType.Contact.fields.getMap() : Schema.SObjectType.Lead.fields.getMap();
        try {
            List<SObject> rows = isContact
                ? (List<SObject>) [SELECT Id, Field, DataType, OldValue, NewValue, CreatedBy.Name, CreatedDate
                                   FROM ContactHistory WHERE ContactId = :leadId
                                   ORDER BY CreatedDate DESC LIMIT 100]
                : (List<SObject>) [SELECT Id, Field, DataType, OldValue, NewValue, CreatedBy.Name, CreatedDate
                                   FROM LeadHistory WHERE LeadId = :leadId
                                   ORDER BY CreatedDate DESC LIMIT 100];
            for (SObject row : rows) {
                HistoryRow h = new HistoryRow(row);
                if (h.DataType == 'EntityId' || HISTORY_NOISE_FIELDS.contains(h.Field)
                        || HISTORY_NOISE_USERS.contains(h.createdByName)) {
                    continue;
                }
                String label;
                if (h.Field == 'created') {
                    label = isContact ? 'Contact created' : 'Lead created';
                } else {
                    Schema.SObjectField f = leadFields.get(h.Field.toLowerCase());
                    if (f != null) {
                        Schema.DescribeFieldResult d = f.getDescribe();
                        if (!d.isAccessible()) {
                            continue; // never show values of fields this user can't read
                        }
                        label = d.getLabel();
                    } else {
                        label = h.Field; // pseudo-fields such as Owner
                    }
                }
                TimelineItem i = new TimelineItem();
                i.key = h.rowKey;
                i.label = label;
                i.oldValue = h.OldValue == null ? null : String.valueOf(h.OldValue);
                i.newValue = h.NewValue == null ? null : String.valueOf(h.NewValue);
                i.who = h.createdByName;
                i.happenedAt = h.createdAt;
                t.history.add(i);
                if (t.history.size() >= 25) {
                    break;
                }
            }
        } catch (Exception e) {
            System.debug(LoggingLevel.WARN, 'Field history not readable: ' + e.getMessage());
        }
        try {
            List<Task> tasks = (List<Task>) Security.stripInaccessible(AccessType.READABLE,
                [SELECT Id, Subject, TaskSubtype, Description, Owner.Name, CreatedDate FROM Task
                 WHERE WhoId = :leadId ORDER BY CreatedDate DESC LIMIT 100]).getRecords();
            for (Task k : tasks) {
                String subj = k.Subject == null ? '' : k.Subject;
                if (subj.startsWith('Website Visit') || subj.containsIgnoreCase('Subscribed to Eloqua')
                        || subj.containsIgnoreCase('Email Opened')) {
                    continue;
                }
                TimelineItem i = new TimelineItem();
                i.key = k.Id;
                i.label = subj;
                i.who = k.Owner == null ? null : k.Owner.Name;
                i.happenedAt = k.CreatedDate;
                i.kind = taskKind(k.TaskSubtype);
                i.body = k.Description;
                t.activity.add(i);
                if (t.activity.size() >= 25) {
                    break;
                }
            }
        } catch (Exception e) {
            System.debug(LoggingLevel.WARN, 'Tasks not readable: ' + e.getMessage());
        }
        try {
            List<Event> events = (List<Event>) Security.stripInaccessible(AccessType.READABLE,
                [SELECT Id, Subject, Description, Owner.Name, CreatedDate FROM Event
                 WHERE WhoId = :leadId ORDER BY CreatedDate DESC LIMIT 25]).getRecords();
            for (Event ev : events) {
                TimelineItem i = new TimelineItem();
                i.key = ev.Id;
                i.label = ev.Subject == null ? '' : ev.Subject;
                i.who = ev.Owner == null ? null : ev.Owner.Name;
                i.happenedAt = ev.CreatedDate;
                i.kind = 'event';
                i.body = ev.Description;
                t.activity.add(i);
            }
        } catch (Exception e) {
            System.debug(LoggingLevel.WARN, 'Events not readable: ' + e.getMessage());
        }
        sortActivityNewestFirst(t.activity);
        while (t.activity.size() > 25) {
            t.activity.remove(t.activity.size() - 1);
        }
        return t;
    }

    /** Task.TaskSubtype -> 'call' | 'email' | 'task' (ListEmail counts as email). */
    @TestVisible
    private static String taskKind(String subtype) {
        if (subtype == 'Call') {
            return 'call';
        }
        if (subtype == 'Email' || subtype == 'ListEmail' || subtype == 'LinkedIn') {
            return 'email';
        }
        return 'task';
    }

    private static void sortActivityNewestFirst(List<TimelineItem> items) {
        for (Integer i = 1; i < items.size(); i++) {
            TimelineItem cur = items[i];
            Integer j = i - 1;
            while (j >= 0 && items[j].happenedAt < cur.happenedAt) {
                items[j + 1] = items[j];
                j--;
            }
            items[j + 1] = cur;
        }
    }

    /** Logs a completed Call task on the Lead / Contact; comments (canvas aabc, #96E) go into Task.Description. */
    @AuraEnabled
    public static void logCall(Id submissionId, String outcome, String comments) {
        Id me = UserInfo.getUserId();
        try {
            Item sub = readItem(submissionId);
            requireMine(sub, me);
            requireLinked(sub);
            Task t = new Task(
                WhoId = sub.leadId != null ? sub.leadId : sub.contactId,
                OwnerId = me,
                Subject = ('Call: ' + (String.isBlank(outcome) ? 'Logged' : outcome)).left(255),
                TaskSubtype = 'Call',
                ActivityDate = Date.today(),
                Status = closedTaskStatus(),
                // Canvas aabc (#96E): the LDR's call comments go first in Description, then where it was logged from.
                Description = ((String.isBlank(comments) ? '' : comments.trim().left(30000) + '\n\n')
                    + 'Logged from LDR Inbox (' + (sub.isKbmax ? '3D Configurator quote ' : sub.isEstimate ? 'Instant Estimate ' : 'Form Submission ') + sub.id + ')')
            );
            Database.insert(t, AccessLevel.USER_MODE);
        } catch (AuraHandledException e) {
            throw e;
        } catch (Exception e) {
            throw auraError('Could not log the call: ' + e.getMessage());
        }
    }

    // ---------------------------------------------------------------- Helpers

    private static void writeLeadFields(Id submissionId, String status, String outcome,
                                        String ldrProjectName, String ldrNotes, Map<String, String> preConversion,
                                        Boolean asAdmin) {
        Id me = UserInfo.getUserId();
        try {
            Item sub = readItem(submissionId);
            // asAdmin: unclaimed, or (v7) claimed by another LDR; otherwise only the claimer
            if (!asAdmin) {
                requireMine(sub, me);
            }
            requireLinked(sub);
            Boolean isLead = sub.leadId != null;
            // Status Reason isn't written (on Leads it depends on Status and production maps nothing to Wrong profile /
            // Disqualified). Lead Funnel Outcome is flagged in the inbox for those statuses but not enforced here.
            SObject upd = blankRecord(sub);
            if (String.isNotBlank(status)) {
                upd.put(statusField(sub), status);
            }
            upd.put('Lead_Funnel_Outcome__c', String.isBlank(outcome) ? null : outcome);
            // LDR Project Name / LDR Notes are no longer edited in the inbox; null means "leave as is".
            if (isLead && ldrProjectName != null) {
                upd.put('LDR_Project_Name__c', ldrProjectName.left(155));
            }
            if (isLead && ldrNotes != null) {
                upd.put('LDR_Notes__c', ldrNotes.left(255));
            }
            if (preConversion != null) {
                Set<String> allowed = isLead ? PRE_CONVERSION_FIELDS : CONTACT_EDIT_FIELDS;
                for (String field : preConversion.keySet()) {
                    if (!allowed.contains(field)) {
                        throw auraError('Field not allowed from the LDR Inbox: ' + field);
                    }
                    upd.put(field, typedValue(upd.getSObjectType(), field, preConversion.get(field)));
                }
            }
            Database.update(upd, AccessLevel.USER_MODE);
        } catch (AuraHandledException e) {
            throw e;
        } catch (Exception e) {
            throw auraError('Save failed: ' + e.getMessage());
        }
    }

    /** Locks a queue item (form submission or instant estimate) FOR UPDATE, in USER_MODE. */
    private static Item lockItem(Id itemId) {
        return queryItem(itemId, true);
    }

    private static Item readItem(Id itemId) {
        return queryItem(itemId, false);
    }

    private static Item queryItem(Id itemId, Boolean forUpdate) {
        if (itemId == null) {
            throw auraError('Submission not found or not visible to you.');
        }
        String lockClause = forUpdate ? ' FOR UPDATE' : '';
        List<SObject> rows = Database.query(itemSelect(itemId.getSObjectType())
            + ' WHERE Id = :itemId WITH USER_MODE LIMIT 1' + lockClause);
        if (rows.isEmpty()) {
            throw auraError('Submission not found or not visible to you.');
        }
        return new Item(rows[0]);
    }

    /** Several queue items of ONE object type in one query (USER_MODE, no lock), by Id. Ids not visible are absent. */
    private static Map<Id, Item> readItems(List<Id> itemIds) {
        Map<Id, Item> out = new Map<Id, Item>();
        if (itemIds == null || itemIds.isEmpty()) {
            return out;
        }
        Integer lim = itemIds.size();
        for (SObject r : Database.query(itemSelect(itemIds[0].getSObjectType())
                + ' WHERE Id IN :itemIds WITH USER_MODE LIMIT :lim')) {
            out.put(r.Id, new Item(r));
        }
        return out;
    }

    /** "SELECT ... FROM <object>" with the fields Item needs, for a Form Submission, Instant Estimate or KBMax quote. */
    private static String itemSelect(Schema.SObjectType objType) {
        String objectName = String.valueOf(objType);
        String soql;
        if (objType == Form_Submission__c.SObjectType) {
            soql = 'SELECT Id, Lead__c, Contact__c, Claimed_By__c, ClaimedDate__c, Claimed_Date__c, Email_Address__c, Inquiry_Type__c,'
                + ' Submit_Time__c, CreatedDate, Lead__r.IsConverted, Lead__r.ConvertedContactId'
                + ' FROM Form_Submission__c';
        } else if (objectName == ESTIMATE_OBJECT) {
            if (!estimatesClaimable()) {
                throw auraError('Instant estimates can\'t be claimed yet: Website_Instant_Estimate__c needs Claimed_By__c and ClaimedDate__c.');
            }
            soql = 'SELECT Id, Lead__c, Contact__c, Claimed_By__c, ClaimedDate__c, Claimed_Date__c, Email_Address__c, CreatedDate,'
                + ' Lead__r.IsConverted, Lead__r.ConvertedContactId FROM ' + ESTIMATE_OBJECT;
        } else if (objectName == KBMAX_OBJECT) {
            if (!kbmaxClaimable()) {
                throw auraError('3D configurator prospects can\'t be claimed yet: KBMax_Web_Quote__c needs Claimed_By__c and ClaimedDate__c.');
            }
            soql = 'SELECT Id, Lead__c, Contact__c, Claimed_By__c, ClaimedDate__c, Claimed_Date__c, Email__c, CreatedDate,'
                + ' Lead__r.IsConverted, Lead__r.ConvertedContactId FROM ' + KBMAX_OBJECT;
        } else {
            throw auraError('Not a Form Submission, Instant Estimate or 3D configurator quote.');
        }
        return soql;
    }

    private static Boolean isLinked(Item sub) {
        return sub.leadId != null || sub.contactId != null;
    }

    private static void requireLinked(Item sub) {
        if (!isLinked(sub)) {
            throw auraError('No Lead or Contact is linked to this submission yet. Refresh in a minute, or create the Lead first.');
        }
    }

    /** The submission's linked Lead, else its Contact, with the fields claim/release need. */
    private static SObject readRecord(Item sub) {
        if (sub.leadId != null) {
            return [
                SELECT Id, Status, Project_Coordinator__c, Lead_Funnel_Time_Stamp__c
                FROM Lead WHERE Id = :sub.leadId WITH USER_MODE LIMIT 1
            ];
        }
        return [
            SELECT Id, Lead_Funnel_Status__c, Project_Coordinator__c, Lead_Funnel_Time_Stamp__c
            FROM Contact WHERE Id = :sub.contactId WITH USER_MODE LIMIT 1
        ];
    }

    /** An empty Lead/Contact with just the Id, for partial updates. */
    private static SObject blankRecord(Item sub) {
        Id recId = sub.leadId != null ? sub.leadId : sub.contactId;
        return recId.getSObjectType().newSObject(recId);
    }

    /** Lead.Status on a Lead, Contact.Lead_Funnel_Status__c on a Contact. */
    private static String statusField(Item sub) {
        return sub.leadId != null ? 'Status' : 'Lead_Funnel_Status__c';
    }

    private static void requireMine(Item sub, Id me) {
        if (sub.claimedBy != me) {
            throw auraError('Claim this lead first. Only the LDR who claimed it can change it.');
        }
    }

    /**
     * Reads Lead or Contact field history written by this user since the claim to find what the claim
     * replaced. Field history is not written during Apex tests, so noHistory is true there.
     */
    @TestVisible
    private static ClaimContext claimContextFor(Item sub, Id me) {
        ClaimContext ctx = new ClaimContext();
        // ClaimedDate__c (#156); a claim from before it was backfilled to midnight Pacific, so history after that counts
        // (a claim the one-time move hasn't reached yet: its old Claimed Date, so release still finds the coordinator)
        Datetime since = sub.claimedAt != null ? sub.claimedAt.addMinutes(-1)
            : sub.claimedDay != null ? pacificDatetime(sub.claimedDay, 0) : Datetime.now().addDays(-1);
        List<SObject> raw2;
        if (Test.isRunningTest()) {
            raw2 = new List<SObject>();
        } else if (sub.leadId != null) {
            raw2 = [
                SELECT Id, Field, DataType, OldValue, NewValue, CreatedBy.Name, CreatedDate FROM LeadHistory
                WHERE LeadId = :sub.leadId AND CreatedById = :me AND CreatedDate >= :since
                  AND Field IN ('Project_Coordinator__c', 'Lead_Funnel_Time_Stamp__c')
                ORDER BY CreatedDate ASC
            ];
        } else {
            raw2 = [
                SELECT Id, Field, DataType, OldValue, NewValue, CreatedBy.Name, CreatedDate FROM ContactHistory
                WHERE ContactId = :sub.contactId AND CreatedById = :me AND CreatedDate >= :since
                  AND Field IN ('Project_Coordinator__c', 'Lead_Funnel_Time_Stamp__c')
                ORDER BY CreatedDate ASC
            ];
        }
        List<HistoryRow> rows = new List<HistoryRow>();
        for (SObject x : raw2) {
            rows.add(new HistoryRow(x));
        }
        ctx.noHistory = rows.isEmpty();
        for (HistoryRow h : rows) {
            if (h.Field == 'Project_Coordinator__c' && !ctx.coordinatorChangedByClaim && h.DataType == 'EntityId') {
                ctx.coordinatorChangedByClaim = true;
                ctx.previousCoordinatorId = h.OldValue == null ? null : Id.valueOf(String.valueOf(h.OldValue));
            } else if (h.Field == 'Project_Coordinator__c' && h.DataType != 'EntityId' && ctx.previousCoordinatorName == null) {
                ctx.previousCoordinatorName = h.OldValue == null ? null : String.valueOf(h.OldValue);
            } else if (h.Field == 'Lead_Funnel_Time_Stamp__c' && !ctx.funnelTsChangedByClaim) {
                ctx.funnelTsChangedByClaim = true;
                Object v = h.OldValue;
                ctx.previousFunnelTs = v == null ? null
                    : (v instanceof Date) ? (Date) v
                    : (v instanceof Datetime) ? ((Datetime) v).date()
                    : Date.valueOf(String.valueOf(v));
            }
        }
        ctx.tookOverFrom = (ctx.previousCoordinatorId != null && ctx.previousCoordinatorId != me)
            ? ctx.previousCoordinatorName : null;
        ctx.claimedAt = sub.claimedAt; // #152 E / #156: the take-over reminder's 24 hours
        ctx.canReassign = ctx.coordinatorChangedByClaim && ctx.previousCoordinatorId != null && ctx.previousCoordinatorId != me
            && ctx.previousCoordinatorId.getSObjectType() == User.SObjectType;
        return ctx;
    }

    private static Map<Id, Integer> countByLookup(String objectName, String lookupField, Set<Id> ids) {
        Map<Id, Integer> counts = new Map<Id, Integer>();
        if (ids.isEmpty() || !hasField(objectName, lookupField)) {
            return counts;
        }
        try {
            String soql = 'SELECT ' + lookupField + ' lid, COUNT(Id) n FROM ' + objectName
                + ' WHERE ' + lookupField + ' IN :ids GROUP BY ' + lookupField;
            for (AggregateResult ar : (List<AggregateResult>) Database.query(soql)) {
                counts.put((Id) ar.get('lid'), (Integer) ar.get('n'));
            }
        } catch (Exception e) {
            System.debug(LoggingLevel.WARN, objectName + ' counts not readable: ' + e.getMessage());
        }
        return counts;
    }

    /** Converts a string from the UI to the field's type on Lead/Contact (date, lookup, number, checkbox, or text). */
    @TestVisible
    private static Object typedValue(Schema.SObjectType objType, String field, String v) {
        Schema.SObjectField sf = fieldMap(String.valueOf(objType)).get(field.toLowerCase());
        if (sf == null) {
            // e.g. X6Sense_Option__c is optional per org; without this the save failed with a bare null dereference
            throw auraError(field + ' doesn\'t exist on ' + objType + ' in this org.');
        }
        Schema.DisplayType t = sf.getDescribe().getType();
        if (t == Schema.DisplayType.BOOLEAN) {
            return v == 'true'; // a checkbox is never null: blank = unchecked
        }
        if (String.isBlank(v)) {
            return null;
        }
        if (t == Schema.DisplayType.DATE) {
            return Date.valueOf(v);
        }
        if (t == Schema.DisplayType.REFERENCE) {
            return Id.valueOf(v);
        }
        if (t == Schema.DisplayType.DOUBLE || t == Schema.DisplayType.CURRENCY || t == Schema.DisplayType.PERCENT) {
            return Decimal.valueOf(v);
        }
        return v;
    }

    private static String money(Decimal v) {
        return '$' + v.setScale(0).format();
    }

    private static String claimerName(Id userId) {
        List<User> u = [SELECT Name FROM User WHERE Id = :userId LIMIT 1];
        return u.isEmpty() ? 'Another LDR' : u[0].Name;
    }

    private static String closedTaskStatus() {
        List<TaskStatus> s = [SELECT ApiName FROM TaskStatus WHERE IsClosed = true ORDER BY SortOrder LIMIT 1];
        return s.isEmpty() ? 'Completed' : s[0].ApiName;
    }

    /**
     * True when a status is set but isn't an active value of the field's picklist any more (production 2026-10-21: Contact
     * Lead Funnel Status "Inactive" 40k+, "Remarket", "Awaiting Info"; Lead "Close - No Further Action", "Attempting
     * Contact"). Claiming resets such a record to New, so it shows in Mine instead of dropping out at once.
     */
    @TestVisible
    private static Boolean isRetiredStatus(String objectName, String field, String value) {
        if (String.isBlank(value)) {
            return false;
        }
        Map<String, Schema.SObjectField> fields = fieldMap(objectName);
        Schema.SObjectField f = fields == null ? null : fields.get(field.toLowerCase());
        return f != null && !picklistValues(f.getDescribe()).contains(value);
    }

    private static List<String> picklistValues(Schema.DescribeFieldResult f) {
        List<String> vals = new List<String>();
        for (Schema.PicklistEntry pe : f.getPicklistValues()) {
            if (pe.isActive()) {
                vals.add(pe.getValue());
            }
        }
        return vals;
    }


    // ================================================================ PROSPECTS / POST QUOTE / BOSS VIEW (canvas a111)

    /** Used when Custom Label LDR_Prospect_Since is blank or invalid: Sep 1, 2026 00:00 Pacific (production go-live). */
    @TestVisible static final Datetime DEFAULT_PROSPECT_SINCE = Datetime.newInstanceGmt(2026, 9, 1, 7, 0, 0);
    @TestVisible static final Integer PROSPECT_ESTIMATE_LIMIT = 1500;
    /** Configurator quotes read for the Prospects list (newest first). */
    @TestVisible static final Integer PROSPECT_QUOTE_ROWS = 20000;
    @TestVisible static final String KBMAX_OBJECT = 'KBMax_Web_Quote__c';
    /** Post Quote: 6sense inbound email Tasks; Contacts in a "<150k" 6sense campaign. */
    @TestVisible static final String POST_QUOTE_SUBJECT = '%[6sense] [Email] [In]%';
    @TestVisible static final String POST_QUOTE_CAMPAIGN = '%150k%';
    /** Internal agent emails carry the CASL footer; replies that contain it are not customer replies. */
    @TestVisible static final String POST_QUOTE_EXCLUDE_TEXT = 'CASL';
    /** Post Quote "Action taken" (canvas #140): a reply is done when its Comments (Task.Description) end with #<tag>. */
    @TestVisible static final List<String> POST_QUOTE_TAGS = new List<String>{ 'Updated', 'Escalated', 'FJTRSent', 'NoActionNeeded' };
    @TestVisible static final Set<String> PROJECT_EDIT_FIELDS = new Set<String>{
        'Stage__c', 'Reason_Project_Lost__c', 'Lost_to__c', 'Stage_Detail__c'
    };
    @TestVisible static final Set<String> OPP_EDIT_FIELDS = new Set<String>{ 'StageName', 'StageDetail__c' };
    /** LDRs shown on the Boss View dashboard (canvas a111). A Custom Metadata list would be the cleaner long-term option. */
    @TestVisible static final List<String> DASHBOARD_LDRS = new List<String>{
        'Aqil Bassa', 'WeiWei Huang', 'Yasmin Hernandez', 'Jahmanz Williams', 'Jabir Nana', 'Samantha Sanchez', 'Aziz Nana'
    };
    @TestVisible static final String LINK_FIXED_TAG = '#LinkFixed';
    @TestVisible static final String FIX_REVIEWED_TAG = '#FixReviewed';
    /** Tag for submissions linked by email (contains LINK_FIXED_TAG, so the review list finds both). */
    @TestVisible static final String LINK_FIXED_EMAIL_TAG = '#LinkFixed-email';
    /** Had both a Lead and a Contact: the Lead link was removed (canvas wording, 2026-10-14). */
    @TestVisible static final String LINK_FIXED_BOTH_TAG = '#LinkFixed-both';
    /** On a converted Lead: now points to its Contact. */
    @TestVisible static final String LINK_FIXED_CONVERTED_TAG = '#LinkFixed-converted';

    /** Start of the Prospects / Post Quote window, from Custom Label LDR_Prospect_Since (ISO date-time). */
    @TestVisible
    private static Datetime prospectSince() {
        try {
            String v = System.Label.LDR_Prospect_Since;
            if (String.isNotBlank(v)) {
                return parseIsoDatetime(v);
            }
        } catch (Exception e) {
            System.debug(LoggingLevel.WARN, 'LDR_Prospect_Since unreadable: ' + e.getMessage());
        }
        return DEFAULT_PROSPECT_SINCE;
    }

    private static String sinceLabel(Datetime d) {
        return d.format('MMM d, yyyy', PACIFIC_TZ);
    }

    /** Field paths that exist: direct fields are checked on the object, relationship paths (with a dot) are kept. */
    @TestVisible
    private static String presentPaths(String objectName, List<String> paths) {
        List<String> keep = new List<String>();
        for (String p : paths) {
            String t = p.trim();
            if (t == '') {
                continue;
            }
            if (t.contains('.') || t == 'Id' || hasField(objectName, t)) {
                keep.add(t);
            }
        }
        return dedupeFields(String.join(keep, ', '));
    }

    /** The Lead__r.* (or Contact__r.*) entries of LINKED_RECORD_FIELDS, without the prefix. */
    private static List<String> linkedPaths(String prefix) {
        List<String> out = new List<String>();
        for (String f : LINKED_RECORD_FIELDS.split(',')) {
            String t = f.trim();
            if (t.startsWith(prefix)) {
                out.add(t.substring(prefix.length()));
            }
        }
        return out;
    }

    public class ConfigPerson {
        @AuraEnabled public Id personId;
        @AuraEnabled public Boolean isContact;
        /** The Lead or Contact, with the fields the queue reads through Lead__r / Contact__r plus a few more. */
        @AuraEnabled public SObject rec;
        @AuraEnabled public Integer quotes;
        @AuraEnabled public Integer quotes30;
        @AuraEnabled public Decimal maxPrice;
        @AuraEnabled public Datetime latestAt;
        @AuraEnabled public Datetime firstAt;
        /** The row's quote's LastModifiedDate (canvas #132: Mine / Finished date and sort). */
        @AuraEnabled public Datetime lastModifiedAt;
        /** The row's record: the person's latest quote (claimed rows: their latest claimed quote). */
        @AuraEnabled public Id quoteId;
        @AuraEnabled public Id claimedById;
        @AuraEnabled public String claimedByName;
        @AuraEnabled public Datetime claimedAt;
        /** The claimed quote's Comments__c (#156: the inbox's automation tags; KBMax_Web_Quote__c had none before). */
        @AuraEnabled public String comments;
        /** Latest quote (canvas dd24 card): model and which design files it has (card flags). */
        @AuraEnabled public String latestModel;
        /** Latest quote's Project Type (KBMax_Web_Quote__c.Type_of_record__c), for residential vs commercial (#118). */
        @AuraEnabled public String latestProjectType;
        /** Latest quote's Project Name (#160: the Draft Email subject uses the quote's own name). */
        @AuraEnabled public String latestProjectName;
        @AuraEnabled public Boolean hasRevit = false;
        @AuraEnabled public Boolean hasIfc = false;
        @AuraEnabled public Boolean hasDrawing = false;
        public Id latestQuoteId;
        public Boolean anyClaimed = false;
    }

    public class ProspectResult {
        @AuraEnabled public List<SObject> estimates = new List<SObject>();
        @AuraEnabled public Map<Id, Integer> estimateCounts = new Map<Id, Integer>();
        @AuraEnabled public Map<Id, Datetime> estimateFirstAt = new Map<Id, Datetime>();
        @AuraEnabled public List<ConfigPerson> configurator = new List<ConfigPerson>();
        /** LDR_Prospect_Since: the 3D configurator detail's "Quotes since" (stats still count from there). */
        @AuraEnabled public String sinceLabel;
        /** Canvas #149 B: the lists show people with an estimate / quote in the last this many days. */
        @AuraEnabled public Integer prospectDays = PROSPECT_DAYS;
        @AuraEnabled public Boolean configuratorClaimable = false;
        @AuraEnabled public Boolean estimatesCapped = false;
        @AuraEnabled public Boolean configuratorCapped = false;
        @AuraEnabled public String error;
    }

    /**
     * Prospects tab (outbound): price-range instant estimates on untouched Leads (status New, no Project Coordinator,
     * not claimed) and people who built 3D configurator quotes (KBMax_Web_Quote__c), from the last PROSPECT_DAYS days
     * (canvas #149 B; was since LDR_Prospect_Since). Read-only; scoring and the hide rules run in the LWC.
     */
    @AuraEnabled
    public static ProspectResult getProspects() {
        ProspectResult r = new ProspectResult();
        Datetime since = prospectSince();
        Datetime recent = Datetime.now().addDays(-PROSPECT_DAYS);
        r.sinceLabel = sinceLabel(since);
        r.configuratorClaimable = kbmaxClaimable();
        List<String> errors = new List<String>();
        // ---- 1) instant estimates with a price range
        if (estimatesClaimable()) {
            try {
                Map<String, Object> binds = new Map<String, Object>{
                    'amounts' => QUEUE_ESTIMATE_AMOUNTS, 'since' => recent, 'lim' => PROSPECT_ESTIMATE_LIMIT
                };
                List<SObject> ests = Database.queryWithBinds(
                    'SELECT ' + dedupeFields(estimateSelectList() + ', Lead__r.DoNotCall, Lead__r.HasOptedOutOfEmail' + ceLeadPaths())
                    + ' FROM ' + ESTIMATE_OBJECT
                    + ' WHERE Estimate_Amount__c != null AND Estimate_Amount__c NOT IN :amounts AND CreatedDate >= :since'
                    + ' AND Lead__c != null AND Lead__r.IsConverted = false AND Lead__r.Status = \'New\''
                    + ' AND Lead__r.Project_Coordinator__c = null AND Claimed_By__c = null'
                    + ' ORDER BY CreatedDate DESC LIMIT :lim', binds, AccessLevel.SYSTEM_MODE);
                r.estimatesCapped = ests.size() >= PROSPECT_ESTIMATE_LIMIT;
                // One row per Lead: the newest estimate (the list is newest first).
                Set<Id> seen = new Set<Id>();
                List<SObject> keep = new List<SObject>();
                for (SObject e : ests) {
                    Id lid = (Id) e.get('Lead__c');
                    if (seen.add(lid)) {
                        keep.add(e);
                    }
                }
                r.estimates = Security.stripInaccessible(AccessType.READABLE, keep).getRecords();
                if (!seen.isEmpty()) {
                    for (AggregateResult ag : (List<AggregateResult>) Database.queryWithBinds(
                            'SELECT Lead__c lid, COUNT(Id) n, MIN(CreatedDate) firstAt FROM ' + ESTIMATE_OBJECT
                            + ' WHERE Lead__c IN :ids GROUP BY Lead__c',
                            new Map<String, Object>{ 'ids' => seen }, AccessLevel.SYSTEM_MODE)) {
                        Id lid = (Id) ag.get('lid');
                        r.estimateCounts.put(lid, (Integer) ag.get('n'));
                        r.estimateFirstAt.put(lid, (Datetime) ag.get('firstAt'));
                    }
                }
            } catch (Exception e) {
                errors.add('Instant estimates: ' + e.getMessage());
            }
        }
        // ---- 2) 3D configurator people with a quote in the last PROSPECT_DAYS days. Read from LDR_Prospect_Since as
        // before, so someone with an older claimed quote stays out of Prospects (they're in the queue) and the stats
        // ("Quotes since ...") keep their start date.
        try {
            for (ConfigPerson p : configuratorPeople(since, false, r)) {
                if (p.latestAt != null && p.latestAt >= recent) {
                    r.configurator.add(p);
                }
            }
        } catch (Exception e) {
            errors.add('3D configurator: ' + e.getMessage());
        }
        r.error = errors.isEmpty() ? null : String.join(errors, ' | ');
        return r;
    }

    /** KBMax_Web_Quote__c has its own claim fields (to be created before go-live; read dynamically until then). */
    @TestVisible
    private static Boolean kbmaxClaimable() {
        return hasField(KBMAX_OBJECT, 'Claimed_By__c') && hasField(KBMAX_OBJECT, CLAIMED_AT);
    }

    /**
     * 3D configurator people (one per Lead / Contact; Contact wins when a quote has both) from KBMax_Web_Quote__c
     * created on/after since. claimedOnly = the queue's claimed rows (people whose quotes are claimed); otherwise the
     * Prospects list (people with no claimed quote). Stats cover all of the person's quotes since the start date.
     */
    @TestVisible
    private static List<ConfigPerson> configuratorPeople(Datetime since, Boolean claimedOnly, ProspectResult r) {
        List<ConfigPerson> out = new List<ConfigPerson>();
        Boolean claimable = kbmaxClaimable();
        if (claimedOnly && !claimable) {
            return out;
        }
        String claimFields = (claimable ? ', Claimed_By__c, Claimed_By__r.Name, ' + CLAIMED_AT : '')
            + (hasField(KBMAX_OBJECT, 'Comments__c') ? ', Comments__c' : '');
        Map<String, Object> binds = new Map<String, Object>{ 'since' => since, 'lim' => PROSPECT_QUOTE_ROWS };
        Integer lim = PROSPECT_QUOTE_ROWS;
        Set<Id> people = new Set<Id>();
        Datetime d30 = Datetime.now().addDays(-30);
        String cond = ' WHERE CreatedDate >= :since AND (Lead__c != null OR Contact__c != null)';
        if (claimedOnly) {
            // People with a claimed quote, then all of their quotes for the stats.
            for (SObject q : Database.queryWithBinds('SELECT Lead__c, Contact__c FROM ' + KBMAX_OBJECT + cond
                    + ' AND Claimed_By__c != null LIMIT 2000', binds, AccessLevel.SYSTEM_MODE)) {
                people.add(q.get('Contact__c') != null ? (Id) q.get('Contact__c') : (Id) q.get('Lead__c'));
            }
            if (people.isEmpty()) {
                return out;
            }
            cond += ' AND (Contact__c IN :people OR Lead__c IN :people)';
        }
        Map<Id, ConfigPerson> byKey = new Map<Id, ConfigPerson>();
        Integer rows = 0;
        // Newest first, so the first quote seen per person is their latest (and their latest claimed one).
        // SOQL for loop over Database.query (binds: since, lim, people) so up to 20,000 quotes are read in batches
        // of 200 instead of held in the heap at once.
        String soql = 'SELECT Id, Lead__c, Contact__c, CreatedDate, LastModifiedDate, KBMax_Price__c' + claimFields + ' FROM ' + KBMAX_OBJECT
            + cond + ' ORDER BY CreatedDate DESC LIMIT :lim';
        for (List<SObject> chunk : Database.query(soql)) {
            for (SObject q : chunk) {
                rows++;
                Id cid = (Id) q.get('Contact__c');
                Id key = cid != null ? cid : (Id) q.get('Lead__c');
                ConfigPerson p = byKey.get(key);
                Datetime at = (Datetime) q.get('CreatedDate');
                if (p == null) {
                    p = new ConfigPerson();
                    p.personId = key;
                    p.isContact = cid != null;
                    p.quotes = 0;
                    p.quotes30 = 0;
                    p.maxPrice = 0;
                    p.latestAt = at;
                    p.quoteId = q.Id;
                    p.lastModifiedAt = (Datetime) q.get('LastModifiedDate');
                    p.latestQuoteId = q.Id;
                    byKey.put(key, p);
                }
                p.quotes++;
                if (at >= d30) {
                    p.quotes30++;
                }
                p.firstAt = at;
                Decimal price = (Decimal) q.get('KBMax_Price__c');
                if (price != null && price > p.maxPrice) {
                    p.maxPrice = price;
                }
                if (claimable && q.get('Claimed_By__c') != null) {
                    if (!p.anyClaimed) {
                        p.anyClaimed = true;
                        p.quoteId = q.Id;
                        p.lastModifiedAt = (Datetime) q.get('LastModifiedDate');
                        p.claimedById = (Id) q.get('Claimed_By__c');
                        SObject cb = q.getSObject('Claimed_By__r');
                        p.claimedByName = cb == null ? null : (String) cb.get('Name');
                        p.claimedAt = (Datetime) q.get(CLAIMED_AT);
                        p.comments = claimFields.contains('Comments__c') ? (String) q.get('Comments__c') : null;
                    }
                }
            }
        }
        if (r != null) {
            r.configuratorCapped = rows >= PROSPECT_QUOTE_ROWS;
        }
        Set<Id> leadIds = new Set<Id>();
        Set<Id> contactIds = new Set<Id>();
        for (ConfigPerson p : byKey.values()) {
            if (p.anyClaimed != claimedOnly) {
                continue; // Prospects: never someone already claimed; queue: only the claimed
            }
            if (p.isContact) {
                contactIds.add(p.personId);
            } else {
                leadIds.add(p.personId);
            }
        }
        Map<Id, SObject> recs = configuratorRecords(leadIds, contactIds);
        for (ConfigPerson p : byKey.values()) {
            SObject rec = recs.get(p.personId);
            if (rec == null || p.anyClaimed != claimedOnly) {
                continue;
            }
            // A converted Lead is worked as its Contact (prospects only; a claimed row stays where it was claimed).
            if (!claimedOnly && !p.isContact && rec.get('IsConverted') == true) {
                continue;
            }
            p.rec = rec;
            out.add(p);
        }
        latestQuoteFacts(out);
        return out;
    }

    /** Model and design-file flags from each person's latest quote (read in one pass; fields read dynamically). */
    private static void latestQuoteFacts(List<ConfigPerson> people) {
        Map<Id, ConfigPerson> byQuote = new Map<Id, ConfigPerson>();
        for (ConfigPerson p : people) {
            if (p.latestQuoteId != null) {
                byQuote.put(p.latestQuoteId, p);
            }
        }
        if (byQuote.isEmpty()) {
            return;
        }
        String fields = presentPaths(KBMAX_OBJECT, new List<String>{
            'Id', 'Product__c', 'Type_of_record__c', 'Project_Name__c', 'Revit_RFA_File_URL__c', 'Revit_IFC_File_URL__c', 'Drawing_File_URL__c',
            'CAD_PDF_File_URL__c'
        });
        Set<Id> ids = byQuote.keySet();
        try {
            for (List<SObject> chunk : Database.query('SELECT ' + fields + ' FROM ' + KBMAX_OBJECT + ' WHERE Id IN :ids')) {
                for (SObject q : chunk) {
                    ConfigPerson p = byQuote.get(q.Id);
                    p.latestModel = textOf(q, 'Product__c');
                    p.latestProjectType = textOf(q, 'Type_of_record__c');
                    p.latestProjectName = textOf(q, 'Project_Name__c');
                    p.hasRevit = String.isNotBlank(textOf(q, 'Revit_RFA_File_URL__c'));
                    p.hasIfc = String.isNotBlank(textOf(q, 'Revit_IFC_File_URL__c'));
                    p.hasDrawing = String.isNotBlank(textOf(q, 'Drawing_File_URL__c')) || String.isNotBlank(textOf(q, 'CAD_PDF_File_URL__c'));
                }
            }
        } catch (Exception e) {
            System.debug(LoggingLevel.WARN, 'Latest quote facts not readable: ' + e.getMessage());
        }
    }

    /** The Leads / Contacts behind configurator rows, with the fields the queue reads through Lead__r / Contact__r. */
    private static Map<Id, SObject> configuratorRecords(Set<Id> leadIds, Set<Id> contactIds) {
        List<String> leadPaths = linkedPaths('Lead__r.');
        leadPaths.addAll(new List<String>{
            'Id', 'FirstName', 'LastName', 'Company', 'Phone', 'MobilePhone', 'Type__c', 'IsConverted', 'ConvertedContactId',
            'CreatedDate', 'DoNotCall', 'HasOptedOutOfEmail', 'Territory__c', 'Type_of_record__c', 'Project_Application_Industry__c'
        });
        leadPaths.addAll(CE_FIELDS);
        List<String> contactPaths = linkedPaths('Contact__r.');
        contactPaths.addAll(new List<String>{
            'Id', 'FirstName', 'LastName', 'Phone', 'MobilePhone', 'LeadType__c', 'CreatedDate', 'DoNotCall',
            'HasOptedOutOfEmail', 'Territory__c'
        });
        contactPaths.addAll(CE_FIELDS);
        Map<Id, SObject> recs = new Map<Id, SObject>();
        if (!leadIds.isEmpty()) {
            for (SObject l : Security.stripInaccessible(AccessType.READABLE, Database.queryWithBinds(
                    'SELECT ' + presentPaths('Lead', leadPaths) + ' FROM Lead WHERE Id IN :ids',
                    new Map<String, Object>{ 'ids' => leadIds }, AccessLevel.SYSTEM_MODE)).getRecords()) {
                recs.put(l.Id, l);
            }
        }
        if (!contactIds.isEmpty()) {
            for (SObject c : Security.stripInaccessible(AccessType.READABLE, Database.queryWithBinds(
                    'SELECT ' + presentPaths('Contact', contactPaths) + ' FROM Contact WHERE Id IN :ids',
                    new Map<String, Object>{ 'ids' => contactIds }, AccessLevel.SYSTEM_MODE)).getRecords()) {
                recs.put(c.Id, c);
            }
        }
        return recs;
    }

    public class ConfigQuote {
        @AuraEnabled public Id id;
        @AuraEnabled public Datetime createdAt;
        @AuraEnabled public String model;
        @AuraEnabled public String productType;
        @AuraEnabled public String project;
        @AuraEnabled public Decimal price;
        @AuraEnabled public String kbQuoteId;
        @AuraEnabled public String status;
        @AuraEnabled public Boolean sent;
        @AuraEnabled public String renderUrl;
        /** Position_file_image_1..4_Id__c ('' when the field is missing or blank). */
        @AuraEnabled public List<String> positionImageIds;
        @AuraEnabled public String specUrl;
        @AuraEnabled public String rfaUrl;
        @AuraEnabled public String ifcUrl;
        @AuraEnabled public String drawingUrl;
        @AuraEnabled public String cadPdfUrl;
        @AuraEnabled public String zipUrl;
        @AuraEnabled public String savedProjectUrl;
        @AuraEnabled public String positions;
        @AuraEnabled public String sceneVideoId;
    }

    /** A 3D configurator person's quotes since LDR_Prospect_Since (newest first), with the latest quote's files. */
    @AuraEnabled
    public static List<ConfigQuote> getConfiguratorDetail(Id personId) {
        List<ConfigQuote> out = new List<ConfigQuote>();
        if (personId == null) {
            return out;
        }
        String lookup = personId.getSObjectType() == Contact.SObjectType ? 'Contact__c' : 'Lead__c';
        List<String> want = new List<String>{
            'Id', 'CreatedDate', 'Product__c', 'Product_Type__c', 'Project_Name__c', 'KBMax_Price__c', 'KBMax_Quote_Id__c',
            'Status__c', 'KBMax_Sent__c', 'Render_File_URL__c', 'Specification_File_URL__c', 'Revit_RFA_File_URL__c',
            'Revit_IFC_File_URL__c', 'Drawing_File_URL__c', 'CAD_PDF_File_URL__c', 'Zip_File_Link__c',
            'Link_to_Visual_Studio__c', 'Position_File_Ids__c', 'Scene_Video_File_Id__c',
            // New per-position fields (canvas dd24); read only when they exist, preferred over Position_File_Ids__c.
            'Position_file_image_1_Id__c', 'Position_file_image_2_Id__c', 'Position_file_image_3_Id__c', 'Position_file_image_4_Id__c'
        };
        String fields = presentPaths(KBMAX_OBJECT, want);
        List<SObject> rows = Security.stripInaccessible(AccessType.READABLE, Database.queryWithBinds(
            'SELECT ' + fields + ' FROM ' + KBMAX_OBJECT + ' WHERE ' + lookup + ' = :pid AND CreatedDate >= :since'
            + ' ORDER BY CreatedDate DESC LIMIT 50',
            new Map<String, Object>{ 'pid' => personId, 'since' => prospectSince() }, AccessLevel.SYSTEM_MODE)).getRecords();
        for (SObject q : rows) {
            ConfigQuote c = new ConfigQuote();
            c.id = q.Id;
            c.createdAt = (Datetime) q.get('CreatedDate');
            c.model = textOf(q, 'Product__c');
            c.productType = textOf(q, 'Product_Type__c');
            c.project = textOf(q, 'Project_Name__c');
            String price = textOf(q, 'KBMax_Price__c');
            c.price = price == null ? null : Decimal.valueOf(price);
            c.kbQuoteId = textOf(q, 'KBMax_Quote_Id__c');
            c.status = textOf(q, 'Status__c');
            c.sent = textOf(q, 'KBMax_Sent__c') == 'true';
            c.renderUrl = textOf(q, 'Render_File_URL__c');
            c.specUrl = textOf(q, 'Specification_File_URL__c');
            c.rfaUrl = textOf(q, 'Revit_RFA_File_URL__c');
            c.ifcUrl = textOf(q, 'Revit_IFC_File_URL__c');
            c.drawingUrl = textOf(q, 'Drawing_File_URL__c');
            c.cadPdfUrl = textOf(q, 'CAD_PDF_File_URL__c');
            c.zipUrl = hrefOf(textOf(q, 'Zip_File_Link__c'));
            c.savedProjectUrl = hrefOf(textOf(q, 'Link_to_Visual_Studio__c'));
            c.positions = textOf(q, 'Position_File_Ids__c');
            List<String> posIds = new List<String>();
            for (Integer i = 1; i <= 4; i++) {
                String v = textOf(q, 'Position_file_image_' + i + '_Id__c');
                posIds.add(v == null ? '' : v);
            }
            c.positionImageIds = posIds;
            c.sceneVideoId = textOf(q, 'Scene_Video_File_Id__c');
            out.add(c);
        }
        return out;
    }

    /** The href of an HTML link formula (or the value itself when it is already a URL). */
    @TestVisible
    private static String hrefOf(String v) {
        if (String.isBlank(v)) {
            return null;
        }
        if (v.startsWith('http')) {
            return v;
        }
        Matcher m = Pattern.compile('href="([^"]+)"').matcher(v);
        return m.find() ? m.group(1).unescapeHtml4() : null;
    }

    // ---------------------------------------------------------------- Post Quote

    public class PostQuoteEmail {
        @AuraEnabled public Id taskId;
        @AuraEnabled public Datetime at;
        @AuraEnabled public String subject;
        @AuraEnabled public String body;
        /** Tag the Task's Comments end with (one of POST_QUOTE_TAGS), else null. */
        @AuraEnabled public String doneTag;
        /** Task.LastModifiedDate / LastModifiedBy: the done time and who marked it (canvas #140). */
        @AuraEnabled public Datetime modifiedAt;
        @AuraEnabled public String modifiedBy;
    }

    public class PostQuoteRow {
        @AuraEnabled public Id contactId;
        @AuraEnabled public String name;
        @AuraEnabled public String email;
        @AuraEnabled public String phone;
        @AuraEnabled public Id accountId;
        @AuraEnabled public String accountName;
        @AuraEnabled public String owner;
        @AuraEnabled public Id coordinatorId;
        @AuraEnabled public String coordinator;
        @AuraEnabled public String city;
        @AuraEnabled public String state;
        @AuraEnabled public String zip;
        @AuraEnabled public String campaign;
        @AuraEnabled public Id projectId;
        @AuraEnabled public String projectName;
        @AuraEnabled public Id oppId;
        @AuraEnabled public String oppName;
        @AuraEnabled public String oppStage;
        @AuraEnabled public Boolean oppClosed = false;
        @AuraEnabled public String oppStageDetail;
        @AuraEnabled public String oppLMBy;
        @AuraEnabled public Datetime oppLMAt;
        @AuraEnabled public String projStage;
        @AuraEnabled public String projReason;
        @AuraEnabled public String projLostTo;
        @AuraEnabled public String projStageDetail;
        @AuraEnabled public String projLMBy;
        @AuraEnabled public Datetime projLMAt;
        /** Matched Opportunity's owner (the Rep, canvas #141) and the Project's owner (Split Territory flag, #142). */
        @AuraEnabled public String oppOwner;
        @AuraEnabled public String projectOwner;
        /** Project__c.Application__c (General Application) and Application_2__c (Specific Application). */
        @AuraEnabled public String generalApp;
        @AuraEnabled public String specificApp;
        @AuraEnabled public List<PostQuoteEmail> emails = new List<PostQuoteEmail>();
    }

    public class PostQuoteResult {
        @AuraEnabled public List<PostQuoteRow> rows = new List<PostQuoteRow>();
        @AuraEnabled public List<String> projStageOptions = new List<String>();
        @AuraEnabled public List<String> reasonOptions = new List<String>();
        @AuraEnabled public List<String> lostToOptions = new List<String>();
        @AuraEnabled public List<String> oppStageOptions = new List<String>();
        @AuraEnabled public String sinceLabel;
        @AuraEnabled public Id userId;
        @AuraEnabled public String error;
    }

    /**
     * Post Quote (every LDR, canvas a111 / #139): replies to the 6sense post-quote emails since LDR_Prospect_Since.
     * Task Subject contains "[6sense] [Email] [In]", Who = a Contact whose sixsense_ce__campaign_name__c contains
     * "150k", Description without the CASL footer. Project = Contact.Conversica_Informational_Statement_2__c; the
     * Opportunity is the one the Contact has a Contact Role on whose Project_Name__c has that name.
     */
    @AuraEnabled
    public static PostQuoteResult getPostQuote() {
        PostQuoteResult r = new PostQuoteResult();
        r.userId = UserInfo.getUserId();
        Datetime since = prospectSince();
        r.sinceLabel = sinceLabel(since);
        try {
            r.projStageOptions = describePicklist('Project__c', 'Stage__c');
            r.reasonOptions = describePicklist('Project__c', 'Reason_Project_Lost__c');
            r.lostToOptions = describePicklist('Project__c', 'Lost_to__c');
            r.oppStageOptions = picklistValues(Opportunity.StageName.getDescribe());
            if (!hasField('Contact', 'sixsense_ce__campaign_name__c') || !hasField('Contact', 'Conversica_Informational_Statement_2__c')) {
                r.error = 'This org is missing Contact.sixsense_ce__campaign_name__c or Conversica_Informational_Statement_2__c.';
                return r;
            }
            Map<Id, List<Task>> tasksByContact = new Map<Id, List<Task>>();
            for (Task t : [
                SELECT Id, Subject, Description, CreatedDate, LastModifiedDate, LastModifiedBy.Name, WhoId
                FROM Task
                WHERE Subject LIKE :POST_QUOTE_SUBJECT AND CreatedDate >= :since AND Who.Type = 'Contact'
                ORDER BY CreatedDate DESC
                LIMIT 2000
            ]) {
                if (t.Description != null && t.Description.contains(POST_QUOTE_EXCLUDE_TEXT)) {
                    continue;
                }
                if (!tasksByContact.containsKey(t.WhoId)) {
                    tasksByContact.put(t.WhoId, new List<Task>());
                }
                tasksByContact.get(t.WhoId).add(t);
            }
            if (tasksByContact.isEmpty()) {
                return r;
            }
            String oppFields = presentPaths('Opportunity', new List<String>{
                'Id', 'Name', 'StageName', 'StageDetail__c', 'IsClosed', 'Project_Name__c', 'Project_Name__r.Name',
                'Owner.Name', 'LastModifiedBy.Name', 'LastModifiedDate'
            });
            List<String> roleFields = new List<String>();
            for (String f : oppFields.split(',')) {
                roleFields.add('Opportunity.' + f.trim());
            }
            List<SObject> contacts = Database.queryWithBinds(
                'SELECT Id, Name, Email, Phone, MobilePhone, AccountId, Account.Name, Owner.Name, Project_Coordinator__c,'
                + ' Project_Coordinator__r.Name, MailingCity, MailingState, MailingPostalCode,'
                + ' sixsense_ce__campaign_name__c, Conversica_Informational_Statement_2__c,'
                + ' (SELECT ' + String.join(roleFields, ', ') + ' FROM OpportunityContactRoles)'
                + ' FROM Contact WHERE Id IN :ids AND sixsense_ce__campaign_name__c LIKE :camp',
                new Map<String, Object>{ 'ids' => tasksByContact.keySet(), 'camp' => POST_QUOTE_CAMPAIGN },
                AccessLevel.SYSTEM_MODE);
            Set<Id> projectIds = new Set<Id>();
            for (SObject c : contacts) {
                PostQuoteRow row = new PostQuoteRow();
                row.contactId = c.Id;
                row.name = (String) c.get('Name');
                row.email = (String) c.get('Email');
                row.phone = String.isNotBlank((String) c.get('Phone')) ? (String) c.get('Phone') : (String) c.get('MobilePhone');
                row.accountId = (Id) c.get('AccountId');
                SObject acct = c.getSObject('Account');
                row.accountName = acct == null ? null : (String) acct.get('Name');
                SObject own = c.getSObject('Owner');
                row.owner = own == null ? null : (String) own.get('Name');
                row.coordinatorId = (Id) c.get('Project_Coordinator__c');
                SObject pc = c.getSObject('Project_Coordinator__r');
                row.coordinator = pc == null ? null : (String) pc.get('Name');
                row.city = (String) c.get('MailingCity');
                row.state = (String) c.get('MailingState');
                row.zip = (String) c.get('MailingPostalCode');
                row.campaign = (String) c.get('sixsense_ce__campaign_name__c');
                row.projectName = (String) c.get('Conversica_Informational_Statement_2__c');
                for (SObject ocr : c.getSObjects('OpportunityContactRoles') == null ? new List<SObject>() : c.getSObjects('OpportunityContactRoles')) {
                    SObject o = ocr.getSObject('Opportunity');
                    if (o == null) {
                        continue;
                    }
                    SObject proj = o.getSObject('Project_Name__r');
                    String pName = proj == null ? null : (String) proj.get('Name');
                    Boolean match = String.isNotBlank(row.projectName) && pName != null && pName.equalsIgnoreCase(row.projectName.trim());
                    if (match || (row.oppId == null && String.isBlank(row.projectName))) {
                        row.oppId = o.Id;
                        row.oppName = (String) o.get('Name');
                        row.oppStage = (String) o.get('StageName');
                        row.oppClosed = o.get('IsClosed') == true;
                        row.oppStageDetail = textOf(o, 'StageDetail__c');
                        SObject lm = o.getSObject('LastModifiedBy');
                        row.oppLMBy = lm == null ? null : (String) lm.get('Name');
                        row.oppLMAt = (Datetime) o.get('LastModifiedDate');
                        SObject oo = o.getSObject('Owner');
                        row.oppOwner = oo == null ? null : (String) oo.get('Name');
                        row.projectId = (Id) o.get('Project_Name__c');
                        if (match) {
                            break;
                        }
                    }
                }
                if (row.projectId != null) {
                    projectIds.add(row.projectId);
                }
                for (Task t : tasksByContact.get(c.Id)) {
                    PostQuoteEmail em = new PostQuoteEmail();
                    em.taskId = t.Id;
                    em.at = t.CreatedDate;
                    em.subject = t.Subject == null ? '' : t.Subject.replace('[6sense] [Email] [In] ', '');
                    em.body = replyOnly(stripPostQuoteTag(t.Description));
                    em.doneTag = postQuoteTagOf(t.Description);
                    em.modifiedAt = t.LastModifiedDate;
                    em.modifiedBy = t.LastModifiedBy == null ? null : t.LastModifiedBy.Name;
                    row.emails.add(em);
                }
                r.rows.add(row);
            }
            if (!projectIds.isEmpty()) {
                String pf = presentPaths('Project__c', new List<String>{
                    'Id', 'Name', 'Stage__c', 'Reason_Project_Lost__c', 'Lost_to__c', 'Stage_Detail__c', 'Application__c', 'Application_2__c',
                    'Owner.Name', 'LastModifiedBy.Name', 'LastModifiedDate'
                });
                Map<Id, SObject> projects = new Map<Id, SObject>();
                for (SObject p : Database.queryWithBinds('SELECT ' + pf + ' FROM Project__c WHERE Id IN :ids',
                        new Map<String, Object>{ 'ids' => projectIds }, AccessLevel.SYSTEM_MODE)) {
                    projects.put(p.Id, p);
                }
                for (PostQuoteRow row : r.rows) {
                    SObject p = row.projectId == null ? null : projects.get(row.projectId);
                    if (p == null) {
                        continue;
                    }
                    row.projectName = (String) p.get('Name');
                    row.projStage = textOf(p, 'Stage__c');
                    row.projReason = textOf(p, 'Reason_Project_Lost__c');
                    row.projLostTo = textOf(p, 'Lost_to__c');
                    row.projStageDetail = textOf(p, 'Stage_Detail__c');
                    row.generalApp = textOf(p, 'Application__c');
                    row.specificApp = textOf(p, 'Application_2__c');
                    SObject po = p.getSObject('Owner');
                    row.projectOwner = po == null ? null : (String) po.get('Name');
                    SObject lm = p.getSObject('LastModifiedBy');
                    row.projLMBy = lm == null ? null : (String) lm.get('Name');
                    row.projLMAt = (Datetime) p.get('LastModifiedDate');
                }
            }
        } catch (Exception e) {
            r.error = e.getMessage();
        }
        return r;
    }

    /** The person's own reply (quoted thread cut at "On … wrote:" / "From:" / "Original Message"), at most 4000 chars. */
    @TestVisible
    private static String replyOnly(String body) {
        if (String.isBlank(body)) {
            return '';
        }
        String t = body.replace('\r', '');
        Matcher m = Pattern.compile('(?i)\\n\\s*(On [^\\n]{3,200}wrote:|From:\\s|-{3,}\\s*Original Message)').matcher(t);
        if (m.find() && m.start() > 0) {
            t = t.substring(0, m.start());
        }
        t = t.trim();
        return t.length() > 4000 ? t.substring(0, 4000) + '…' : t;
    }

    /** The #tag a post-quote reply's Comments end with (trailing whitespace ignored), else null. */
    @TestVisible
    private static String postQuoteTagOf(String description) {
        if (String.isBlank(description)) {
            return null;
        }
        String t = description.replaceAll('\\s+$', '');
        for (String tag : POST_QUOTE_TAGS) {
            if (t.endsWith('#' + tag)) {
                return tag;
            }
        }
        return null;
    }

    /** The Comments without their trailing #tag and the whitespace before it; unchanged when there is no tag. */
    @TestVisible
    private static String stripPostQuoteTag(String description) {
        String tag = postQuoteTagOf(description);
        return tag == null ? description : description.replaceAll('\\s+$', '').removeEnd('#' + tag).replaceAll('\\s+$', '');
    }

    /**
     * Post Quote "Action taken" (canvas #140): adds #tag on a new line at the end of the reply email Task's Comments
     * (Description), replacing a tag already there; undo removes it. User mode, so Task edit access is enforced. The
     * reply then counts as done (Finished / All for 7 days from Task.LastModifiedDate).
     */
    @AuraEnabled
    public static PostQuoteEmail markPostQuoteReply(Id taskId, String tag, Boolean undo) {
        Boolean isUndo = undo == true;
        if (taskId == null || taskId.getSObjectType() != Task.SObjectType) {
            throw auraError('Pick a reply email first.');
        }
        if (!isUndo && !POST_QUOTE_TAGS.contains(tag)) {
            throw auraError('Tag not allowed: ' + tag);
        }
        List<Task> found = [SELECT Id, Description FROM Task WHERE Id = :taskId AND Subject LIKE :POST_QUOTE_SUBJECT LIMIT 1];
        if (found.isEmpty()) {
            throw auraError('That email isn\'t a post-quote reply, or it isn\'t shared with you.');
        }
        String base = stripPostQuoteTag(found[0].Description);
        String next = isUndo ? base : (String.isBlank(base) ? '' : base + '\n') + '#' + tag;
        if (next != null && next.length() > 32000) {
            throw auraError('The email\'s Comments are full, so the tag can\'t be added.');
        }
        try {
            Database.update(new Task(Id = taskId, Description = next), AccessLevel.USER_MODE);
        } catch (DmlException e) {
            throw auraError('Could not update the email: ' + e.getDmlMessage(0));
        } catch (Exception e) {
            throw auraError('Could not update the email: ' + e.getMessage());
        }
        Task t = [SELECT Id, Description, LastModifiedDate, LastModifiedBy.Name FROM Task WHERE Id = :taskId];
        PostQuoteEmail em = new PostQuoteEmail();
        em.taskId = t.Id;
        em.doneTag = postQuoteTagOf(t.Description);
        em.modifiedAt = t.LastModifiedDate;
        em.modifiedBy = t.LastModifiedBy == null ? null : t.LastModifiedBy.Name;
        return em;
    }

    private static List<String> describePicklist(String objectName, String fieldName) {
        if (!hasField(objectName, fieldName)) {
            return new List<String>();
        }
        return picklistValues(fieldMap(objectName).get(fieldName.toLowerCase()).getDescribe());
    }

    /**
     * Post Quote Save: Project__c and Opportunity fields, in user mode. Blank values clear the field. The page saves
     * each box on its own (canvas #140), passing null for the other side's id and map.
     */
    @AuraEnabled
    public static void savePostQuote(Id projectId, Id oppId, Map<String, String> projectFields, Map<String, String> oppFields) {
        Savepoint sp = Database.setSavepoint();
        try {
            if (projectId != null && projectFields != null && !projectFields.isEmpty()) {
                SObject p = Schema.getGlobalDescribe().get('project__c').newSObject(projectId);
                for (String f : projectFields.keySet()) {
                    if (!PROJECT_EDIT_FIELDS.contains(f)) {
                        throw auraError('Field not allowed: Project__c.' + f);
                    }
                    String v = projectFields.get(f);
                    p.put(f, String.isBlank(v) ? null : v);
                }
                Database.update(p, AccessLevel.USER_MODE);
            }
            if (oppId != null && oppFields != null && !oppFields.isEmpty()) {
                Opportunity o = new Opportunity(Id = oppId);
                for (String f : oppFields.keySet()) {
                    if (!OPP_EDIT_FIELDS.contains(f)) {
                        throw auraError('Field not allowed: Opportunity.' + f);
                    }
                    String v = oppFields.get(f);
                    if (f == 'StageName' && String.isBlank(v)) {
                        throw auraError('Opportunity Stage can\'t be blank.');
                    }
                    o.put(f, String.isBlank(v) ? null : v);
                }
                Database.update(o, AccessLevel.USER_MODE);
            }
        } catch (AuraHandledException e) {
            Database.rollback(sp);
            throw e;
        } catch (DmlException e) {
            Database.rollback(sp);
            throw auraError('Save failed: ' + e.getDmlMessage(0));
        } catch (Exception e) {
            Database.rollback(sp);
            throw auraError('Save failed: ' + e.getMessage());
        }
    }

    // ---------------------------------------------------------------- link safety net (canvas a111)

    public class LinkFixResult {
        @AuraEnabled public Integer fixed = 0;
        @AuraEnabled public Integer failed = 0;
        @AuraEnabled public String firstError;
    }

    /**
     * Safety net until the conversion fix is in (runs when the inbox loads, user mode): a Form Submission or instant
     * estimate with BOTH Lead__c and Contact__c gets Lead__c cleared; one on a CONVERTED Lead with no Contact__c gets
     * Contact__c = Lead.ConvertedContactId and Lead__c cleared; an unlinked one is linked by email (see below). Each
     * fixed record is tagged "#LinkFixed..." so admins can review it, in its Comments field (#156: tagField). 3D
     * configurator rows (KBMax_Web_Quote__c) are left out (#156 made them taggable; joining the list is optional).
     */
    @AuraEnabled
    public static LinkFixResult fixLinks(List<Id> submissionIds) {
        LinkFixResult res = new LinkFixResult();
        if (submissionIds == null || submissionIds.isEmpty()) {
            return res;
        }
        Map<String, List<Id>> byObject = linkFixTargets(submissionIds);
        List<SObject> rows = new List<SObject>();
        for (String obj : byObject.keySet()) {
            rows.addAll(Database.queryWithBinds(
                'SELECT Id, Lead__c, Contact__c, Email_Address__c, Lead__r.IsConverted, Lead__r.ConvertedContactId'
                + tagSelect(obj) + ' FROM ' + obj + ' WHERE Id IN :ids LIMIT 200',
                new Map<String, Object>{ 'ids' => byObject.get(obj) }, AccessLevel.SYSTEM_MODE));
        }
        // Canvas 12d4: unlinked submissions are linked by email. Exactly one Contact with that email -> Contact__c;
        // else exactly one unconverted Lead -> Lead__c. Several matches, or a Contact and an open Lead: left alone.
        Set<String> emails = new Set<String>();
        for (SObject f : rows) {
            String em = (String) f.get('Email_Address__c');
            if (f.get('Lead__c') == null && f.get('Contact__c') == null && String.isNotBlank(em)) {
                emails.add(em.trim().toLowerCase());
            }
        }
        Map<String, Set<Id>> contactsByEmail = new Map<String, Set<Id>>();
        Map<String, Set<Id>> leadsByEmail = new Map<String, Set<Id>>();
        if (!emails.isEmpty()) {
            for (Contact c : [SELECT Id, Email FROM Contact WHERE Email IN :emails LIMIT 2000]) {
                String k = c.Email.toLowerCase();
                if (!contactsByEmail.containsKey(k)) {
                    contactsByEmail.put(k, new Set<Id>());
                }
                contactsByEmail.get(k).add(c.Id);
            }
            for (Lead l : [SELECT Id, Email FROM Lead WHERE Email IN :emails AND IsConverted = false LIMIT 2000]) {
                String k = l.Email.toLowerCase();
                if (!leadsByEmail.containsKey(k)) {
                    leadsByEmail.put(k, new Set<Id>());
                }
                leadsByEmail.get(k).add(l.Id);
            }
        }
        List<SObject> upds = new List<SObject>();
        for (SObject f : rows) {
            String obj = String.valueOf(f.getSObjectType());
            String tagFld = tagField(obj);
            SObject u = f.getSObjectType().newSObject(f.Id);
            String tag = LINK_FIXED_TAG;
            Id leadId = (Id) f.get('Lead__c');
            Id contactId = (Id) f.get('Contact__c');
            SObject lead = f.getSObject('Lead__r');
            String em = (String) f.get('Email_Address__c');
            if (leadId != null && contactId != null) {
                u.put('Lead__c', null);
                tag = LINK_FIXED_BOTH_TAG;
            } else if (leadId != null && lead != null && lead.get('IsConverted') == true && lead.get('ConvertedContactId') != null) {
                u.put('Contact__c', (Id) lead.get('ConvertedContactId'));
                u.put('Lead__c', null);
                tag = LINK_FIXED_CONVERTED_TAG;
            } else if (leadId == null && contactId == null && String.isNotBlank(em)) {
                String k = em.trim().toLowerCase();
                Set<Id> cs = contactsByEmail.containsKey(k) ? contactsByEmail.get(k) : new Set<Id>();
                Set<Id> ls = leadsByEmail.containsKey(k) ? leadsByEmail.get(k) : new Set<Id>();
                if (cs.size() == 1 && ls.isEmpty()) {
                    u.put('Contact__c', new List<Id>(cs)[0]);
                } else if (cs.isEmpty() && ls.size() == 1) {
                    u.put('Lead__c', new List<Id>(ls)[0]);
                } else {
                    continue;
                }
                tag = LINK_FIXED_EMAIL_TAG;
            } else {
                continue;
            }
            // #156: tagged in the Comments field; skipped when it already has a #LinkFixed tag (new or old place) or is full
            if (hasField(obj, tagFld) && !tagText(f, obj).contains(LINK_FIXED_TAG)) {
                String tagged = withTag(pathText(f, tagFld), tag);
                if (tagged != null) {
                    u.put(tagFld, tagged);
                }
            }
            upds.add(u);
        }
        if (upds.isEmpty()) {
            return res;
        }
        Database.SaveResult[] srs = Database.update(upds, false, AccessLevel.USER_MODE);
        for (Database.SaveResult sr : srs) {
            if (sr.isSuccess()) {
                res.fixed++;
            } else {
                res.failed++;
                if (res.firstError == null && !sr.getErrors().isEmpty()) {
                    res.firstError = sr.getErrors()[0].getMessage();
                }
            }
        }
        return res;
    }

    /**
     * The ids the link safety net handles, grouped by object: Form_Submission__c always; Website_Instant_Estimate__c
     * when it has Lead__c / Contact__c (notes #89B). Anything else (e.g. KBMax_Web_Quote__c) is ignored.
     */
    @TestVisible
    private static Map<String, List<Id>> linkFixTargets(List<Id> ids) {
        Map<String, List<Id>> byObject = new Map<String, List<Id>>();
        Boolean estOk = hasField(ESTIMATE_OBJECT, 'Lead__c') && hasField(ESTIMATE_OBJECT, 'Contact__c')
            && hasField(ESTIMATE_OBJECT, 'Email_Address__c');
        for (Id i : ids) {
            if (i == null) {
                continue;
            }
            String obj = String.valueOf(i.getSObjectType());
            if (obj != 'Form_Submission__c' && !(obj == ESTIMATE_OBJECT && estOk)) {
                continue;
            }
            if (!byObject.containsKey(obj)) {
                byObject.put(obj, new List<Id>());
            }
            byObject.get(obj).add(i);
        }
        return byObject;
    }

    /** Admins: mark a fixed link as reviewed ("#FixReviewed" added to the Comments field, #156). */
    @AuraEnabled
    public static void markFixReviewed(Id submissionId) {
        markFixesReviewed(new List<Id>{ submissionId });
    }

    // ------------------------------------------------------------ Junk submissions (canvas dd24, 2026-10-14)

    /** Reasons offered by "Mark as junk"; the tag written to the Comments field (tagField) is '#Junk:' + reason. */
    @TestVisible static final List<String> JUNK_REASONS = new List<String>{
        'Solicitation or sales pitch', 'Fake or invalid contact info', 'Test submission', 'Not a customer (other)'
    };
    @TestVisible static final String JUNK_TAG = '#Junk:';

    // ------------------------------------------------------------ Automation tags (canvas #156)

    /** The new Comments fields are Text Area (255). */
    @TestVisible static final Integer TAG_FIELD_MAX = 255;

    /**
     * Where the inbox writes its tags (#LinkFixed..., #FixReviewed, #Junk:<reason>, #NoContactNeeded; canvas #156):
     * Form_Submission__c.Comments1__c, and Comments__c on instant estimates and 3D configurator quotes.
     */
    @TestVisible
    private static String tagField(String objectName) {
        return objectName == 'Form_Submission__c' ? 'Comments1__c' : 'Comments__c';
    }

    /**
     * Where tags were written before #156, and still are until the one-time move (moveLegacyFields) has run:
     * Form_Submission__c.Comments__c, and the end of an instant estimate's Questions_or_Comments__c. Reads check both.
     */
    @TestVisible
    private static String legacyTagField(String objectName) {
        return objectName == 'Form_Submission__c' ? 'Comments__c'
            : objectName == ESTIMATE_OBJECT ? 'Questions_or_Comments__c' : null;
    }

    /** tagField and legacyTagField, the ones this org has. */
    private static List<String> tagFields(String objectName) {
        List<String> out = new List<String>();
        for (String f : new List<String>{ tagField(objectName), legacyTagField(objectName) }) {
            if (f != null && hasField(objectName, f)) {
                out.add(f);
            }
        }
        return out;
    }

    /** ", <tag field>, <old tag field>" for a SELECT (only the fields this org has). */
    private static String tagSelect(String objectName) {
        List<String> f = tagFields(objectName);
        return f.isEmpty() ? '' : ', ' + String.join(f, ', ');
    }

    /** The record's tags, new field and old place together ('' when blank or not queried). */
    @TestVisible
    private static String tagText(SObject r, String objectName) {
        String out = '';
        for (String f : tagFields(objectName)) {
            String v = pathText(r, f);
            if (String.isNotBlank(v)) {
                out += (out == '' ? '' : ' ') + v;
            }
        }
        return out;
    }

    /**
     * cur with tag added after a space (unchanged when it's already there), or null when the 255-character field has no
     * room: the text already in it is never cut.
     */
    @TestVisible
    private static String withTag(String cur, String tag) {
        String base = String.isBlank(cur) ? '' : cur.trim();
        if (base.contains(tag)) {
            return base;
        }
        String out = base == '' ? tag : base + ' ' + tag;
        return out.length() > TAG_FIELD_MAX ? null : out;
    }

    /** withTag, or an error the inbox shows when the Comments field is full. */
    private static String withTagOrFail(String cur, String tag) {
        String out = withTag(cur, tag);
        if (out == null) {
            throw auraError('The Comments field on this record is full (255 characters), so "' + tag
                + '" can\'t be added. Shorten it on the record, then try again.');
        }
        return out;
    }

    /** The given ids grouped by object (Form_Submission__c / Website_Instant_Estimate__c only; others ignored). */
    private static Map<String, List<Id>> junkTargets(List<Id> ids) {
        Map<String, List<Id>> byObject = new Map<String, List<Id>>();
        for (Id i : ids) {
            if (i == null) {
                continue;
            }
            String obj = String.valueOf(i.getSObjectType());
            if (obj != 'Form_Submission__c' && obj != ESTIMATE_OBJECT) {
                continue;
            }
            if (!hasField(obj, tagField(obj)) || !hasField(obj, 'Claimed_By__c')) {
                throw auraError(obj + '.' + tagField(obj) + ' or Claimed_By__c is missing in this org.');
            }
            if (!byObject.containsKey(obj)) {
                byObject.put(obj, new List<Id>());
            }
            byObject.get(obj).add(i);
        }
        return byObject;
    }

    /** Opens the block after "#Junk:<reason>" that keeps the linked record's previous values (canvas d84b, #94). */
    @TestVisible static final String JUNK_PREV_OPEN = '{prev:';
    /** What a junk mark writes on the clicked row's linked Lead / Contact (#94): Status, and an Outcome per reason (#153 D). */
    @TestVisible static final String JUNK_STATUS = 'Wrong profile';
    @TestVisible static final Map<String, String> JUNK_OUTCOMES = new Map<String, String>{
        'Solicitation or sales pitch' => 'Spam/Solicitation',
        'Fake or invalid contact info' => 'Invalid Contact Information',
        'Test submission' => 'Other',
        'Not a customer (other)' => 'Other'
    };

    /** Today in Pacific time (Lead Funnel Timestamp). */
    @TestVisible
    private static Date todayPacific() {
        return Date.valueOf(Datetime.now().format('yyyy-MM-dd', PACIFIC_TZ));
    }

    /**
     * Lead Status / Contact Lead Funnel Status, Status Reason (when the field exists), Outcome, Lead Funnel Timestamp,
     * Project Coordinator (#153 D; the tag's fifth slot, missing from older junk marks).
     */
    private static List<String> junkRecordFields(Item sub) {
        List<String> f = new List<String>{ statusField(sub) };
        f.add(sub.leadId != null || contactHasStatusReason() ? 'Status_Reason__c' : null);
        f.add('Lead_Funnel_Outcome__c');
        f.add('Lead_Funnel_Time_Stamp__c');
        f.add('Project_Coordinator__c');
        return f;
    }

    /**
     * Mark Form Submissions or instant estimates as junk (solicitation, fake contact info, test): claims each for the
     * current user (so it moves to their Finished tab for FINISHED_DAYS days) and appends "#Junk:<reason>" (see tagField). Rows
     * claimed by someone else are skipped. Returns how many were marked.
     * Canvas d84b (#94) / #153 D: when the clicked row (the first id) is linked to a Lead / Contact, that record also
     * gets Status (Contact: Lead_Funnel_Status__c) = Wrong profile, Lead_Funnel_Outcome__c by reason (JUNK_OUTCOMES),
     * Lead_Funnel_Time_Stamp__c = today (Pacific) and Project_Coordinator__c = the running user. Its previous values
     * go into the tag ("#Junk:<reason>{prev:status|reason|outcome|yyyy-mm-dd|coordinatorId}") so Restore can put
     * them back. Same-email siblings are unlinked by definition, so only the clicked row's record changes.
     */
    @AuraEnabled
    public static Integer markJunk(List<Id> submissionIds, String reason) {
        if (!JUNK_REASONS.contains(reason)) {
            throw auraError('Unknown junk reason.');
        }
        if (submissionIds == null || submissionIds.isEmpty()) {
            return 0;
        }
        Id me = UserInfo.getUserId();
        Id clicked = submissionIds[0];
        Map<String, List<Id>> byObject = junkTargets(submissionIds);
        // The clicked row's linked record (resolved like a claim: a converted Lead counts as its Contact).
        String prevBlock = '';
        SObject recUpd;
        if (clicked != null && byObject.containsKey(String.valueOf(clicked.getSObjectType()))) {
            Item first = readItem(clicked);
            if (isLinked(first)) {
                List<String> flds = junkRecordFields(first);
                Id recId = first.leadId != null ? first.leadId : first.contactId;
                List<String> sel = new List<String>();
                for (String f : flds) {
                    if (f != null) {
                        sel.add(f);
                    }
                }
                SObject cur = Database.query('SELECT Id, ' + String.join(sel, ', ') + ' FROM '
                    + String.valueOf(recId.getSObjectType()) + ' WHERE Id = :recId WITH USER_MODE LIMIT 1');
                List<String> prev = new List<String>();
                for (String f : flds) {
                    Object v = f == null ? null : cur.get(f);
                    prev.add(v == null ? '' : String.valueOf(v));
                }
                prevBlock = JUNK_PREV_OPEN + String.join(prev, '|') + '}';
                recUpd = blankRecord(first);
                recUpd.put(flds[0], JUNK_STATUS);
                // Status Reason is left as it is (2026-10-21); its slot stays in the tag for older junk marks.
                recUpd.put('Lead_Funnel_Outcome__c', JUNK_OUTCOMES.get(reason));
                recUpd.put('Lead_Funnel_Time_Stamp__c', todayPacific());
                recUpd.put('Project_Coordinator__c', me);
            }
        }
        List<SObject> upds = new List<SObject>();
        Boolean clickedMarked = false;
        for (String obj : byObject.keySet()) {
            String fld = tagField(obj);
            Datetime at = Datetime.now();
            List<SObject> rows = Database.queryWithBinds(
                'SELECT Id, Claimed_By__c' + tagSelect(obj) + ' FROM ' + obj + ' WHERE Id IN :ids LIMIT 50 FOR UPDATE',
                new Map<String, Object>{ 'ids' => byObject.get(obj) }, AccessLevel.USER_MODE);
            for (SObject r : rows) {
                Id claimer = (Id) r.get('Claimed_By__c');
                if (claimer != null && claimer != me) {
                    continue;
                }
                Boolean isClicked = r.Id == clicked;
                clickedMarked = clickedMarked || isClicked;
                String cur = stripJunkTag((String) r.get(fld));
                SObject u = r.getSObjectType().newSObject(r.Id);
                u.put('Claimed_By__c', me);
                u.put(CLAIMED_AT, at);
                u.put(fld, withTagOrFail(cur, JUNK_TAG + reason + (isClicked ? prevBlock : '')));
                upds.add(u);
            }
        }
        if (upds.isEmpty()) {
            throw auraError('Nothing to mark: it is claimed by someone else or not visible to you.');
        }
        try {
            Database.update(upds, AccessLevel.USER_MODE);
            if (clickedMarked && recUpd != null) {
                Database.update(recUpd, AccessLevel.USER_MODE);
            }
        } catch (Exception e) {
            // Thrown before the transaction ends, so the claims and tags roll back with it.
            throw auraError('Could not mark it as junk: ' + e.getMessage());
        }
        return upds.size();
    }

    // ------------------------------------------------------------ Status on a submission with no Lead / Contact (v6g7)

    /** The status buttons that work before a Lead / Contact is linked; each writes "#<status>" to the tag field. */
    @TestVisible static final List<String> UNLINKED_STATUSES = new List<String>{ 'Working', 'Unreachable', 'Disqualified' };

    /** text without "#Working" / "#Unreachable" / "#Disqualified" (null when nothing else is left). */
    @TestVisible
    private static String stripStatusTags(String text) {
        if (text == null) {
            return null;
        }
        String out = text.replaceAll('\\s*#(Working|Unreachable|Disqualified)\\b', '').trim();
        return String.isBlank(out) ? null : out;
    }

    /** Release of an unlinked submission: its status tag goes too (added to sub.upd). */
    private static void clearStatusTags(Item sub) {
        String fld = tagField(sub.objectName);
        if (!hasField(sub.objectName, fld)) {
            return;
        }
        Id sid = sub.id;
        List<SObject> cur = Database.queryWithBinds('SELECT ' + fld + ' FROM ' + sub.objectName + ' WHERE Id = :sid LIMIT 1',
            new Map<String, Object>{ 'sid' => sid }, AccessLevel.USER_MODE);
        String v = cur.isEmpty() ? null : (String) cur[0].get(fld);
        String stripped = stripStatusTags(v);
        if (String.isNotBlank(v) && (stripped == null || !stripped.equals(v.trim()))) {
            sub.upd.put(fld, stripped);
        }
    }

    /**
     * v6g7 (Aqil): Working / Unreachable / Disqualified on a form submission or instant estimate that has no Lead or
     * Contact yet. Writes "#<status>" to the tag field (tagField; replaces an earlier status tag) and claims it for the
     * running user when it isn't theirs yet. Unreachable / Disqualified also restart the claim time: the inbox then
     * shows it in Finished (not Mine) for FINISHED_DAYS days from then, like junk. Working keeps an existing claim time.
     */
    @AuraEnabled
    public static void setUnlinkedStatus(Id submissionId, String status) {
        if (!UNLINKED_STATUSES.contains(status)) {
            throw auraError('Unknown status.');
        }
        Id me = UserInfo.getUserId();
        Savepoint sp = Database.setSavepoint();
        try {
            Item sub = lockItem(submissionId);
            if (sub.isKbmax) {
                throw auraError('Status buttons don\'t apply to 3D configurator quotes.');
            }
            if (isLinked(sub)) {
                throw auraError('This submission has a Lead or Contact now. Refresh, then set the status on it.');
            }
            if (sub.claimedBy != null && sub.claimedBy != me) {
                throw auraError('It is claimed by someone else.');
            }
            String fld = tagField(sub.objectName);
            if (!hasField(sub.objectName, fld)) {
                throw auraError(sub.objectName + '.' + fld + ' is missing in this org.');
            }
            Id sid = sub.id;
            List<SObject> cur = Database.queryWithBinds('SELECT ' + fld + ' FROM ' + sub.objectName + ' WHERE Id = :sid LIMIT 1',
                new Map<String, Object>{ 'sid' => sid }, AccessLevel.USER_MODE);
            String v = cur.isEmpty() ? null : (String) cur[0].get(fld);
            if (v != null && v.contains(JUNK_TAG)) {
                throw auraError('It is marked as junk. Restore it first.');
            }
            sub.upd.put(fld, withTagOrFail(stripStatusTags(v), '#' + status));
            if (sub.claimedBy == null || status != 'Working') {
                sub.setClaim(me);
            }
            Database.update(sub.upd, AccessLevel.USER_MODE);
        } catch (AuraHandledException e) {
            Database.rollback(sp);
            throw e;
        } catch (Exception e) {
            Database.rollback(sp);
            throw auraError('Could not set the status: ' + e.getMessage());
        }
    }

    /**
     * The previous values kept in a junk tag ("{prev:a|b|c|d|e}"; older marks have no coordinator, "{prev:a|b|c|d}"),
     * or null when the tag has none.
     */
    @TestVisible
    private static List<String> junkPrev(String text) {
        if (text == null) {
            return null;
        }
        Integer j = text.indexOf(JUNK_TAG);
        if (j < 0) {
            return null;
        }
        Integer openIdx = text.indexOf(JUNK_PREV_OPEN, j);
        Integer nextTag = text.indexOf('#', j + 1);
        if (openIdx < 0 || (nextTag >= 0 && nextTag < openIdx)) {
            return null;
        }
        Integer closeIdx = text.indexOf('}', openIdx);
        if (closeIdx < 0) {
            return null;
        }
        String body = text.substring(openIdx + JUNK_PREV_OPEN.length(), closeIdx);
        List<String> parts = new List<String>();
        Integer pos = 0;
        while (true) {
            Integer bar = body.indexOf('|', pos);
            if (bar < 0) {
                parts.add(body.substring(pos));
                break;
            }
            parts.add(body.substring(pos, bar));
            pos = bar + 1;
        }
        return parts.size() == 4 || parts.size() == 5 ? parts : null;
    }

    /**
     * Undo "Mark as junk": removes the tag and the claim (back to Unclaimed). Only the user who holds the claim, or an
     * admin. When the tag holds the linked record's previous values (#94), Status, Status Reason, Outcome and Lead
     * Funnel Timestamp go back to them.
     */
    @AuraEnabled
    public static Integer restoreJunk(List<Id> submissionIds) {
        if (submissionIds == null || submissionIds.isEmpty()) {
            return 0;
        }
        Id me = UserInfo.getUserId();
        Boolean admin = isAdmin();
        List<SObject> upds = new List<SObject>();
        Map<Id, SObject> recUpds = new Map<Id, SObject>();
        Map<String, List<Id>> byObject = junkTargets(submissionIds);
        for (String obj : byObject.keySet()) {
            // #156: the tag is in the Comments field, or (marked before #156, not moved yet) in the old place
            List<String> tagFlds = tagFields(obj);
            List<SObject> rows = Database.queryWithBinds(
                'SELECT Id, Claimed_By__c' + tagSelect(obj) + ' FROM ' + obj + ' WHERE Id IN :ids LIMIT 50 FOR UPDATE',
                new Map<String, Object>{ 'ids' => byObject.get(obj) }, AccessLevel.USER_MODE);
            // Rows whose tag carries previous values need their linked Lead / Contact: read those items in one query
            // (was one readItem query per row, inside this loop).
            List<Id> needItem = new List<Id>();
            for (SObject r : rows) {
                String cur = tagText(r, obj);
                if (cur.contains(JUNK_TAG) && junkPrev(cur) != null) {
                    needItem.add(r.Id);
                }
            }
            Map<Id, Item> items = readItems(needItem);
            for (SObject r : rows) {
                String cur = tagText(r, obj);
                if (!cur.contains(JUNK_TAG)) {
                    continue;
                }
                if ((Id) r.get('Claimed_By__c') != me && !admin) {
                    continue;
                }
                List<String> prev = junkPrev(cur);
                if (prev != null) {
                    Item sub = items.get(r.Id);
                    if (sub == null) {
                        throw auraError('Submission not found or not visible to you.');
                    }
                    if (isLinked(sub)) {
                        List<String> flds = junkRecordFields(sub);
                        SObject ru = blankRecord(sub);
                        // an older tag (4 slots) has no coordinator: that one stays as it is
                        for (Integer i = 0; i < Math.min(flds.size(), prev.size()); i++) {
                            if (flds[i] == null) {
                                continue;
                            }
                            String v = prev[i];
                            if (flds[i] == 'Lead_Funnel_Time_Stamp__c') {
                                ru.put(flds[i], String.isBlank(v) ? null : Date.valueOf(v));
                            } else {
                                ru.put(flds[i], String.isBlank(v) ? null : v);
                            }
                        }
                        recUpds.put(ru.Id, ru);
                    }
                }
                SObject u = r.getSObjectType().newSObject(r.Id);
                for (String f : tagFlds) {
                    String v = (String) r.get(f);
                    if (v != null && v.contains(JUNK_TAG)) {
                        u.put(f, stripJunkTag(v));
                    }
                }
                u.put('Claimed_By__c', null);
                u.put(CLAIMED_AT, null);
                upds.add(u);
            }
        }
        try {
            Database.update(upds, AccessLevel.USER_MODE);
            if (!recUpds.isEmpty()) {
                Database.update(recUpds.values(), AccessLevel.USER_MODE);
            }
        } catch (Exception e) {
            throw auraError('Could not restore it: ' + e.getMessage());
        }
        return upds.size();
    }

    /**
     * Comments__c / Questions_or_Comments__c without the app's internal tags (#LinkFixed..., #FixReviewed, #Junk:...,
     * #JunkUndone, #NoContactNeeded), for display.
     */
    @TestVisible
    private static String stripInternalTags(String comments) {
        if (comments == null) {
            return null;
        }
        String out = comments.replaceAll('\\s*#(LinkFixed-email|LinkFixed-both|LinkFixed-converted|LinkFixed|FixReviewed|JunkUndone|NoContactNeeded)\\b', '');
        out = stripStatusTags(out); // v6g7
        return stripJunkTag(out);
    }

    @TestVisible
    private static String stripJunkTag(String comments) {
        if (comments == null) {
            return null;
        }
        String out = comments;
        for (String reason : JUNK_REASONS) {
            String t = JUNK_TAG + reason;
            Integer i = out.indexOf(t);
            while (i >= 0) {
                Integer cutEnd = i + t.length();
                // canvas d84b (#94): the tag may carry "{prev:...}" with the linked record's previous values
                if (out.substring(cutEnd).startsWith(JUNK_PREV_OPEN)) {
                    Integer closeIdx = out.indexOf('}', cutEnd);
                    cutEnd = closeIdx < 0 ? out.length() : closeIdx + 1;
                }
                out = out.substring(0, i) + out.substring(cutEnd);
                i = out.indexOf(t);
            }
        }
        out = out.trim();
        return String.isBlank(out) ? null : out;
    }

    /**
     * Admins: "Clear All" on the fixed-links list (canvas 12d4), and x on one row: "#FixReviewed" added to the
     * Comments field (#156: tagField). Rows that already have it (new or old place) are skipped.
     */
    @AuraEnabled
    public static Integer markFixesReviewed(List<Id> submissionIds) {
        if (!isAdmin()) {
            throw auraError('Only the inbox admins review fixed links.');
        }
        if (submissionIds == null || submissionIds.isEmpty()) {
            return 0;
        }
        Map<String, List<Id>> byObject = linkFixTargets(submissionIds);
        List<SObject> upds = new List<SObject>();
        Integer found = 0;
        for (String obj : byObject.keySet()) {
            String fld = tagField(obj);
            if (!hasField(obj, fld)) {
                throw auraError(obj + '.' + fld + ' is missing in this org.');
            }
            List<SObject> rows = Database.queryWithBinds('SELECT Id' + tagSelect(obj) + ' FROM ' + obj + ' WHERE Id IN :ids LIMIT 500',
                new Map<String, Object>{ 'ids' => byObject.get(obj) }, AccessLevel.USER_MODE);
            found += rows.size();
            for (SObject r : rows) {
                if (tagText(r, obj).contains(FIX_REVIEWED_TAG)) {
                    continue;
                }
                SObject u = r.getSObjectType().newSObject(r.Id);
                u.put(fld, withTagOrFail((String) r.get(fld), FIX_REVIEWED_TAG));
                upds.add(u);
            }
        }
        if (found == 0) {
            throw auraError('Submission not found or not visible to you.');
        }
        try {
            Database.update(upds, AccessLevel.USER_MODE);
        } catch (Exception e) {
            throw auraError('Could not mark them reviewed: ' + e.getMessage());
        }
        return upds.size();
    }

    // ------------------------------------------------------------ One-time move (canvas #156)

    /** What moveLegacyFields did (records saved), and what it left. */
    public class LegacyMoveResult {
        @AuraEnabled public Integer tagsMoved = 0;
        @AuraEnabled public Integer claimTimesFilled = 0;
        /** Moving the tags would take the Comments field past 255 characters: left as they are. */
        @AuraEnabled public Integer skipped = 0;
        @AuraEnabled public Integer failed = 0;
        @AuraEnabled public String firstError;
    }

    /** The inbox went live in Sep 2026, so older records have no tags; the move doesn't read them. */
    @TestVisible static final Datetime LEGACY_TAGS_SINCE = Datetime.newInstanceGmt(2026, 9, 1, 7, 0, 0);

    /** True when a claimed record still has Claimed_Date__c but no ClaimedDate__c (one row per object at most). */
    @TestVisible
    private static Boolean legacyClaimDatesLeft() {
        try {
            for (String obj : new List<String>{ 'Form_Submission__c', ESTIMATE_OBJECT, KBMAX_OBJECT }) {
                // Claimed only: release / Restore clear the claim but leave the old Claimed_Date__c behind
                if (hasField(obj, CLAIMED_AT) && hasField(obj, 'Claimed_Date__c') && !Database.query('SELECT Id FROM ' + obj
                        + ' WHERE Claimed_By__c != null AND Claimed_Date__c != null AND ' + CLAIMED_AT + ' = null LIMIT 1').isEmpty()) {
                    return true;
                }
            }
        } catch (Exception e) {
            System.debug(LoggingLevel.WARN, 'Claim-date check failed: ' + e.getMessage());
        }
        return false;
    }

    /** The inbox's tags as written before #156 (the same set stripInternalTags removes). */
    @TestVisible
    private static Pattern legacyTagPattern() {
        List<String> reasons = new List<String>();
        for (String r : JUNK_REASONS) {
            reasons.add(Pattern.quote(r));
        }
        return Pattern.compile('#(?:LinkFixed-email|LinkFixed-both|LinkFixed-converted|LinkFixed|FixReviewed|JunkUndone|NoContactNeeded)\\b'
            + '|#Junk:(?:' + String.join(reasons, '|') + ')(?:\\{prev:[^}]*\\})?');
    }

    /**
     * Canvas #156's one-time actions, built into the inbox (Aqil, 2026-10-29) instead of a separate script: an admin runs
     * it once after the deploy (Boss View button). Running it again is harmless: it only finds what's still to do, and the
     * inbox reads tags from both places until then.
     * 1. Tags: Form_Submission__c.Comments__c (tags only), #NoContactNeeded at the end of a form's
     *    Questions_or_Comments__c, and the end of an instant estimate's Questions_or_Comments__c -> added to
     *    Comments1__c / Comments__c and removed from the old place (the customer's text stays).
     * 2. Claim time: claimed records with Claimed_Date__c but no ClaimedDate__c get that day at 00:00 Pacific, like the
     *    2026-10-29 backfill (no field-history lookup). Released records keep their old date and are left alone.
     * User mode; each record saves on its own, so one failure doesn't stop the rest.
     */
    @AuraEnabled
    public static LegacyMoveResult moveLegacyFields() {
        if (!isAdmin()) {
            throw auraError('Only the inbox admins can run the one-time move.');
        }
        LegacyMoveResult res = new LegacyMoveResult();
        List<SObject> upds = new List<SObject>();
        List<Boolean> movedTags = new List<Boolean>();
        List<Boolean> filledClaim = new List<Boolean>();
        Pattern tagPattern = legacyTagPattern();
        Datetime since = LEGACY_TAGS_SINCE;
        for (String obj : new List<String>{ 'Form_Submission__c', ESTIMATE_OBJECT, KBMAX_OBJECT }) {
            if (!hasField(obj, CLAIMED_AT) || !hasField(obj, 'Claimed_Date__c')) {
                continue;
            }
            String newFld = tagField(obj);
            // The old places: legacyTagField, plus a form's Questions_or_Comments__c (#NoContactNeeded went there before #156)
            List<String> oldFlds = new List<String>();
            for (String f : new List<String>{ legacyTagField(obj), obj == 'Form_Submission__c' ? 'Questions_or_Comments__c' : null }) {
                if (f != null && hasField(obj, f) && hasField(obj, newFld)) {
                    oldFlds.add(f);
                }
            }
            Boolean tags = !oldFlds.isEmpty();
            // Long text can't be filtered, so tags are looked for on every record touched since go-live (~1,900 today);
            // the SOQL for loop reads them 200 at a time.
            String soql = 'SELECT Id, Claimed_By__c, Claimed_Date__c, ' + CLAIMED_AT
                + (tags ? ', ' + newFld + ', ' + String.join(oldFlds, ', ') : '')
                + ' FROM ' + obj + ' WHERE (Claimed_By__c != null AND Claimed_Date__c != null AND ' + CLAIMED_AT + ' = null)'
                + (tags ? ' OR LastModifiedDate >= :since' : '') + ' WITH USER_MODE';
            for (List<SObject> chunk : Database.query(soql)) {
                for (SObject r : chunk) {
                    SObject u = r.getSObjectType().newSObject(r.Id);
                    Boolean claim = r.get('Claimed_By__c') != null && r.get('Claimed_Date__c') != null && r.get(CLAIMED_AT) == null;
                    if (claim) {
                        u.put(CLAIMED_AT, pacificDatetime((Date) r.get('Claimed_Date__c'), 0));
                    }
                    String cur = tags ? (String) r.get(newFld) : null;
                    Boolean found = false;
                    Boolean full = false;
                    Map<String, String> cleaned = new Map<String, String>();
                    for (String oldFld : oldFlds) {
                        String old = (String) r.get(oldFld);
                        if (old == null || !old.contains('#')) {
                            continue;
                        }
                        Matcher m = tagPattern.matcher(old);
                        Boolean here = false;
                        while (!full && m.find()) {
                            here = true;
                            String next = withTag(cur, m.group());
                            full = next == null;
                            cur = full ? cur : next;
                        }
                        if (here) {
                            found = true;
                            cleaned.put(oldFld, stripInternalTags(old));
                        }
                    }
                    Boolean moved = found && !full;
                    if (full) {
                        res.skipped++;
                    } else if (moved) {
                        u.put(newFld, cur);
                        for (String oldFld : cleaned.keySet()) {
                            u.put(oldFld, cleaned.get(oldFld));
                        }
                    }
                    if (claim || moved) {
                        upds.add(u);
                        movedTags.add(moved);
                        filledClaim.add(claim);
                    }
                }
            }
        }
        Database.SaveResult[] srs = Database.update(upds, false, AccessLevel.USER_MODE);
        for (Integer i = 0; i < srs.size(); i++) {
            if (!srs[i].isSuccess()) {
                res.failed++;
                if (res.firstError == null && !srs[i].getErrors().isEmpty()) {
                    res.firstError = srs[i].getErrors()[0].getMessage();
                }
                continue;
            }
            res.tagsMoved += movedTags[i] ? 1 : 0;
            res.claimTimesFilled += filledClaim[i] ? 1 : 0;
        }
        return res;
    }

    // ---------------------------------------------------------------- Boss View: dashboard + All Submissions

    public class DashMonth {
        @AuraEnabled public String label;
        @AuraEnabled public Map<String, Integer> byLdr = new Map<String, Integer>();
    }

    public class DashboardResult {
        /** period (week | month | lastmonth) -> LDR -> Lead Status -> count (by Lead_Funnel_Time_Stamp__c). */
        @AuraEnabled public Map<String, Map<String, Map<String, Integer>>> leads = new Map<String, Map<String, Map<String, Integer>>>();
        /** period -> LDR -> Opportunities created. */
        @AuraEnabled public Map<String, Map<String, Integer>> opps = new Map<String, Map<String, Integer>>();
        @AuraEnabled public List<DashMonth> monthlyLeads = new List<DashMonth>();
        @AuraEnabled public List<DashMonth> monthlyOpps = new List<DashMonth>();
        @AuraEnabled public List<String> ldrs = new List<String>();
        @AuraEnabled public Datetime asOf;
        /** Claim speed, first outreach and time to Qualified per LDR (canvas 9fed). */
        @AuraEnabled public List<SpeedRow> speed = new List<SpeedRow>();
        @AuraEnabled public String speedSince;
    }

    /** Boss View dashboard (admins), modelled on the "LDR Performance Dashboard". Aggregates only. */
    @AuraEnabled
    public static DashboardResult getDashboard() {
        if (!isAdmin()) {
            throw auraError('The dashboard is only available to the inbox admins.');
        }
        DashboardResult d = buildDashboard(null);
        d.speed = speedFor(new Set<String>(d.ldrs));
        d.speedSince = sinceLabel(SPEED_SINCE);
        return d;
    }

    public class MyDashboardResult {
        @AuraEnabled public String name;
        @AuraEnabled public Datetime asOf;
        /** period -> Lead Status -> count (this user's worked leads, by Lead_Funnel_Time_Stamp__c). */
        @AuraEnabled public Map<String, Map<String, Integer>> leads = new Map<String, Map<String, Integer>>();
        /** period -> worked leads for all dashboard LDRs (for "x% of the team's"). */
        @AuraEnabled public Map<String, Integer> teamWorked = new Map<String, Integer>();
        @AuraEnabled public Map<String, Integer> opps = new Map<String, Integer>();
        @AuraEnabled public List<DashMonth> monthlyLeads = new List<DashMonth>();
        @AuraEnabled public List<DashMonth> monthlyOpps = new List<DashMonth>();
        @AuraEnabled public SpeedRow speed;
        @AuraEnabled public Integer teamClaimed = 0;
        @AuraEnabled public Integer teamSameDay = 0;
        @AuraEnabled public String speedSince;
    }

    /**
     * My Dashboard (canvas 55a9, every LDR): the user's own worked leads by status, opportunities they created and
     * 12-month trends. userId = the "View as" user for admins; anyone else only gets their own.
     */
    @AuraEnabled
    public static MyDashboardResult getMyDashboard(Id userId) {
        Id who = userId == null ? UserInfo.getUserId() : userId;
        if (who != UserInfo.getUserId() && !isAdmin()) {
            throw auraError('You can only see your own dashboard.');
        }
        List<User> us = [SELECT Id, Name FROM User WHERE Id = :who LIMIT 1];
        if (us.isEmpty()) {
            throw auraError('User not found.');
        }
        String name = us[0].Name;
        DashboardResult d = buildDashboard(who);
        MyDashboardResult m = new MyDashboardResult();
        m.name = name;
        m.asOf = d.asOf;
        for (String p : d.leads.keySet()) {
            Map<String, Map<String, Integer>> byLdr = d.leads.get(p);
            m.leads.put(p, byLdr.containsKey(name) ? byLdr.get(name) : new Map<String, Integer>());
            Integer team = 0;
            for (Map<String, Integer> st : byLdr.values()) {
                for (Integer n : st.values()) {
                    team += n;
                }
            }
            m.teamWorked.put(p, team);
            Map<String, Integer> o = d.opps.get(p);
            m.opps.put(p, o != null && o.containsKey(name) ? o.get(name) : 0);
        }
        for (DashMonth dm : d.monthlyLeads) {
            DashMonth x = new DashMonth();
            x.label = dm.label;
            x.byLdr.put(name, dm.byLdr.containsKey(name) ? dm.byLdr.get(name) : 0);
            m.monthlyLeads.add(x);
        }
        for (DashMonth dm : d.monthlyOpps) {
            DashMonth x = new DashMonth();
            x.label = dm.label;
            x.byLdr.put(name, dm.byLdr.containsKey(name) ? dm.byLdr.get(name) : 0);
            m.monthlyOpps.add(x);
        }
        Set<String> team = new Set<String>(d.ldrs);
        team.add(name);
        for (SpeedRow sr : speedFor(team)) {
            if (sr.name == name) {
                m.speed = sr;
            }
            m.teamClaimed += sr.claimed;
            m.teamSameDay += sr.sameDay;
        }
        m.speedSince = sinceLabel(SPEED_SINCE);
        return m;
    }

    /** Who can be picked as Project Coordinator in LDR Fields (Aqil, 2026-10-30), besides the current one. */
    @TestVisible static final List<String> COORDINATOR_NAMES = new List<String>{
        'Aqil Bassa', 'Jahmanz Williams', 'Marco Estebez', 'Samantha Sanchez', 'WeiWei Huang', 'Jabir Nana', 'Yasmin Hernandez',
        'Aziz Nana'
    };

    /** COORDINATOR_NAMES as User Id -> name (active users only). */
    @TestVisible
    private static Map<Id, String> coordinatorUsers() {
        Map<Id, String> out = new Map<Id, String>();
        for (User u : [SELECT Id, Name FROM User WHERE Name IN :COORDINATOR_NAMES AND IsActive = true ORDER BY Name LIMIT 50]) {
            out.put(u.Id, u.Name);
        }
        return out;
    }

    /** Dashboard aggregates for the DASHBOARD_LDRS (plus extraUser when given). */
    private static DashboardResult buildDashboard(Id extraUser) {
        DashboardResult d = new DashboardResult();
        d.asOf = Datetime.now();
        Map<Id, String> ldrById = new Map<Id, String>();
        for (User u : [SELECT Id, Name FROM User WHERE Name IN :DASHBOARD_LDRS OR Id = :extraUser]) {
            ldrById.put(u.Id, u.Name);
        }
        for (String n : DASHBOARD_LDRS) {
            if (ldrById.values().contains(n)) {
                d.ldrs.add(n);
            }
        }
        Set<Id> ids = ldrById.keySet();
        Map<String, String> periods = new Map<String, String>{ 'week' => 'THIS_WEEK', 'month' => 'THIS_MONTH', 'lastmonth' => 'LAST_MONTH' };
        for (String p : periods.keySet()) {
            Map<String, Map<String, Integer>> byLdr = new Map<String, Map<String, Integer>>();
            for (AggregateResult ag : (List<AggregateResult>) Database.queryWithBinds(
                    'SELECT Project_Coordinator__c pc, Status st, COUNT(Id) n FROM Lead WHERE Project_Coordinator__c IN :ids'
                    + ' AND Lead_Funnel_Time_Stamp__c = ' + periods.get(p) + ' GROUP BY Project_Coordinator__c, Status',
                    new Map<String, Object>{ 'ids' => ids }, AccessLevel.SYSTEM_MODE)) {
                String who = ldrById.get((Id) ag.get('pc'));
                if (!byLdr.containsKey(who)) {
                    byLdr.put(who, new Map<String, Integer>());
                }
                byLdr.get(who).put((String) ag.get('st'), (Integer) ag.get('n'));
            }
            d.leads.put(p, byLdr);
            Map<String, Integer> oppBy = new Map<String, Integer>();
            for (AggregateResult ag : (List<AggregateResult>) Database.queryWithBinds(
                    'SELECT CreatedById cb, COUNT(Id) n FROM Opportunity WHERE CreatedById IN :ids AND CreatedDate = '
                    + periods.get(p) + ' GROUP BY CreatedById',
                    new Map<String, Object>{ 'ids' => ids }, AccessLevel.SYSTEM_MODE)) {
                oppBy.put(ldrById.get((Id) ag.get('cb')), (Integer) ag.get('n'));
            }
            d.opps.put(p, oppBy);
        }
        // Last 12 months (this month to date included).
        Date firstMonth = Date.today().toStartOfMonth().addMonths(-11);
        Map<String, DashMonth> leadMonths = new Map<String, DashMonth>();
        Map<String, DashMonth> oppMonths = new Map<String, DashMonth>();
        for (Integer i = 0; i < 12; i++) {
            Date m = firstMonth.addMonths(i);
            String key = m.year() + '-' + m.month();
            String label = Datetime.newInstance(m.year(), m.month(), 1).format('MMM') + (i == 11 ? '*' : '');
            DashMonth a = new DashMonth();
            a.label = label;
            leadMonths.put(key, a);
            d.monthlyLeads.add(a);
            DashMonth b = new DashMonth();
            b.label = label;
            oppMonths.put(key, b);
            d.monthlyOpps.add(b);
        }
        Datetime firstMonthDt = Datetime.newInstance(firstMonth.year(), firstMonth.month(), 1);
        for (AggregateResult ag : (List<AggregateResult>) Database.queryWithBinds(
                'SELECT Project_Coordinator__c pc, CALENDAR_YEAR(Lead_Funnel_Time_Stamp__c) y, CALENDAR_MONTH(Lead_Funnel_Time_Stamp__c) m,'
                + ' COUNT(Id) n FROM Lead WHERE Project_Coordinator__c IN :ids AND Lead_Funnel_Time_Stamp__c >= :fm'
                + ' GROUP BY Project_Coordinator__c, CALENDAR_YEAR(Lead_Funnel_Time_Stamp__c), CALENDAR_MONTH(Lead_Funnel_Time_Stamp__c)',
                new Map<String, Object>{ 'ids' => ids, 'fm' => firstMonth }, AccessLevel.SYSTEM_MODE)) {
            DashMonth dm = leadMonths.get(String.valueOf(ag.get('y')) + '-' + String.valueOf(ag.get('m')));
            if (dm != null) {
                dm.byLdr.put(ldrById.get((Id) ag.get('pc')), (Integer) ag.get('n'));
            }
        }
        for (AggregateResult ag : (List<AggregateResult>) Database.queryWithBinds(
                'SELECT CreatedById cb, CALENDAR_YEAR(convertTimezone(CreatedDate)) y, CALENDAR_MONTH(convertTimezone(CreatedDate)) m,'
                + ' COUNT(Id) n FROM Opportunity WHERE CreatedById IN :ids AND CreatedDate >= :fm'
                + ' GROUP BY CreatedById, CALENDAR_YEAR(convertTimezone(CreatedDate)), CALENDAR_MONTH(convertTimezone(CreatedDate))',
                new Map<String, Object>{ 'ids' => ids, 'fm' => firstMonthDt }, AccessLevel.SYSTEM_MODE)) {
            DashMonth dm = oppMonths.get(String.valueOf(ag.get('y')) + '-' + String.valueOf(ag.get('m')));
            if (dm != null) {
                dm.byLdr.put(ldrById.get((Id) ag.get('cb')), (Integer) ag.get('n'));
            }
        }
        return d;
    }

    // ------------------------------------------------------------ Lead Views: report panels (canvas #110 / #112)

    public class ReportRows {
        @AuraEnabled public String name;
        @AuraEnabled public List<String> columns = new List<String>();
        @AuraEnabled public List<List<String>> rows = new List<List<String>>();
        /** False when Salesforce returned only part of the detail rows (the synchronous Reports API caps at 2,000). */
        @AuraEnabled public Boolean allData = true;
    }

    /**
     * Lead Views tab (admins): runs a report with its saved filters and returns the detail columns and rows for a
     * read-only table (reports can't be embedded in an LWC or edited inline). Rows from every grouping are included.
     * Runs as the user, so the report must be in a folder they can see.
     */
    @AuraEnabled
    public static ReportRows getReportRows(Id reportId) {
        if (!isAdmin()) {
            throw auraError('Lead Views is only available to the inbox admins.');
        }
        if (reportId == null) {
            throw auraError('No report given.');
        }
        ReportRows out = new ReportRows();
        try {
            Reports.ReportResults res = Reports.ReportManager.runReport(reportId, true);
            Reports.ReportMetadata md = res.getReportMetadata();
            out.name = md.getName();
            out.allData = res.getAllData();
            Map<String, Reports.DetailColumn> info = res.getReportExtendedMetadata().getDetailColumnInfo();
            for (String col : md.getDetailColumns()) {
                Reports.DetailColumn dc = info.get(col);
                out.columns.add(dc == null ? col : dc.getLabel());
            }
            Map<String, Reports.ReportFact> facts = res.getFactMap();
            List<String> keys = new List<String>(facts.keySet());
            keys.sort();
            // Tabular reports keep their rows under 'T!T'; grouped reports under each grouping ('0!T', '0_1!T', ...).
            Reports.ReportFact grand = facts.get('T!T');
            if (grand instanceof Reports.ReportFactWithDetails && !((Reports.ReportFactWithDetails) grand).getRows().isEmpty()) {
                keys = new List<String>{ 'T!T' };
            }
            for (String k : keys) {
                if (!k.endsWith('!T') || !(facts.get(k) instanceof Reports.ReportFactWithDetails)) {
                    continue;
                }
                for (Reports.ReportDetailRow dr : ((Reports.ReportFactWithDetails) facts.get(k)).getRows()) {
                    List<String> cells = new List<String>();
                    for (Reports.ReportDataCell c : dr.getDataCells()) {
                        cells.add(c.getLabel());
                    }
                    out.rows.add(cells);
                }
            }
        } catch (Exception e) {
            throw auraError('Could not run the report: ' + e.getMessage());
        }
        return out;
    }

    /**
     * Boss View "All Submissions" (admins): form submissions and Custom instant estimates between two dates. Canvas f123
     * (notes #89C / #90): also returns the email (search), Lead Type__c / Contact LeadType__c (Type filter); the
     * Record / Type / Status / Form / Project Coordinator filters and the stats line are applied in the LWC.
     */
    @AuraEnabled
    public static List<SObject> getAllSubmissions(Date fromDate, Date toDate) {
        if (!isAdmin()) {
            throw auraError('All Submissions is only available to the inbox admins.');
        }
        Date f = fromDate == null ? Date.today().addDays(-365) : fromDate;
        Date t = toDate == null ? Date.today() : toDate;
        Datetime fromDt = Datetime.newInstance(f, Time.newInstance(0, 0, 0, 0));
        Datetime toDt = Datetime.newInstance(t.addDays(1), Time.newInstance(0, 0, 0, 0));
        String person = 'Lead__c, Contact__c, Claimed_By__c, Claimed_By__r.Name, Lead__r.Status, Lead__r.Project_Coordinator__r.Name,'
            + ' Lead__r.Owner.Name, Contact__r.Lead_Funnel_Status__c, Contact__r.Project_Coordinator__r.Name, Contact__r.Owner.Name,'
            + ' Lead__r.Type__c' + (contactField('LeadType__c') != null ? ', Contact__r.LeadType__c' : '');
        Map<String, Object> binds = new Map<String, Object>{ 'f' => fromDt, 't' => toDt, 'excluded' => EXCLUDED_INQUIRIES };
        List<SObject> out = new List<SObject>();
        out.addAll(Security.stripInaccessible(AccessType.READABLE, Database.queryWithBinds(
            'SELECT Id, CreatedDate, Submit_Time__c, First_Name__c, Last_Name__c, Email_Address__c, Inquiry_Type__c, Type__c, Customer_Type__c, '
            + person + ' FROM Form_Submission__c WHERE CreatedDate >= :f AND CreatedDate < :t'
            + ' AND (Inquiry_Type__c = null OR Inquiry_Type__c NOT IN :excluded) ORDER BY CreatedDate DESC LIMIT 2000',
            binds, AccessLevel.SYSTEM_MODE)).getRecords());
        if (estimatesClaimable()) {
            binds.put('amounts', QUEUE_ESTIMATE_AMOUNTS);
            out.addAll(Security.stripInaccessible(AccessType.READABLE, Database.queryWithBinds(
                'SELECT Id, CreatedDate, ' + presentFields(ESTIMATE_OBJECT, 'First_Name__c, Last_Name__c, Email_Address__c, Customer_Type__c') + ', '
                + person + ' FROM ' + ESTIMATE_OBJECT + ' WHERE CreatedDate >= :f AND CreatedDate < :t'
                + ' AND Estimate_Amount__c IN :amounts ORDER BY CreatedDate DESC LIMIT 1000',
                binds, AccessLevel.SYSTEM_MODE)).getRecords());
        }
        return out;
    }


    // ================================================================ canvas 9fed: 6sense, speed, Windfall on Contacts

    /** 6sense Conversational Email fields on Lead and Contact (read dynamically). */
    @TestVisible static final List<String> CE_FIELDS = new List<String>{
        'sixsense_ce__status__c', 'sixsense_ce__last_synced_at__c', 'sixsense_ce__campaign_name__c'
    };
    /** Speed metrics count Form Submissions created on/after the inbox go-live (Oct 6, 2026, Pacific). */
    @TestVisible static final Datetime SPEED_SINCE = Datetime.newInstanceGmt(2026, 10, 6, 7, 0, 0);
    @TestVisible static final List<String> WINDFALL_FIELDS = new List<String>{
        'Windfall_Lead_Grade__c', 'wf_windfall_avm__c', 'wf_net_worth__c', 'wf_high_confidence_net_worth__c',
        'wf_low_confidence_net_worth__c', 'wf_net_worth_calculation_date__c', 'wf_windfall_property_value_1__c',
        'wf_windfall_property_value_2__c', 'wf_windfall_property_value_3__c'
    };

    /** ", Lead__r.sixsense_ce__status__c, ..." for the CE fields that exist on Lead. */
    private static String ceLeadPaths() {
        String out = '';
        for (String f : CE_FIELDS) {
            if (hasField('Lead', f)) {
                out += ', Lead__r.' + f;
            }
        }
        return out;
    }

    /**
     * Windfall for Contact rows. Windfall doesn't move to the Contact on conversion; it is re-populated on the Contact
     * a day or two later. A Contact with no Windfall values of its own gets its converted Lead's values, marked
     * "__fromLead" = "true" (canvas 9fed).
     */
    @TestVisible
    private static Map<Id, Map<String, String>> contactWindfallFor(Set<Id> contactIds) {
        Map<Id, Map<String, String>> out = new Map<Id, Map<String, String>>();
        if (contactIds == null || contactIds.isEmpty()) {
            return out;
        }
        try {
            List<String> cFields = new List<String>();
            List<String> lFields = new List<String>();
            for (String f : WINDFALL_FIELDS) {
                if (hasField('Contact', f)) {
                    cFields.add(f);
                }
                if (hasField('Lead', f)) {
                    lFields.add(f);
                }
            }
            if (!cFields.isEmpty()) {
                for (SObject c : Security.stripInaccessible(AccessType.READABLE, Database.queryWithBinds(
                        'SELECT Id, ' + String.join(cFields, ', ') + ' FROM Contact WHERE Id IN :ids',
                        new Map<String, Object>{ 'ids' => contactIds }, AccessLevel.SYSTEM_MODE)).getRecords()) {
                    Map<String, String> vals = windfallValues(c, cFields);
                    if (hasWindfallNumbers(vals)) {
                        out.put(c.Id, vals);
                    }
                }
            }
            Set<Id> missing = new Set<Id>(contactIds);
            missing.removeAll(out.keySet());
            if (!missing.isEmpty() && !lFields.isEmpty()) {
                for (SObject l : Security.stripInaccessible(AccessType.READABLE, Database.queryWithBinds(
                        'SELECT Id, ConvertedContactId, ' + String.join(lFields, ', ')
                        + ' FROM Lead WHERE IsConverted = true AND ConvertedContactId IN :ids ORDER BY ConvertedDate DESC',
                        new Map<String, Object>{ 'ids' => missing }, AccessLevel.SYSTEM_MODE)).getRecords()) {
                    Id cid = (Id) l.get('ConvertedContactId');
                    if (out.containsKey(cid)) {
                        continue;
                    }
                    Map<String, String> vals = windfallValues(l, lFields);
                    if (!vals.isEmpty()) {
                        vals.put('__fromLead', 'true');
                        out.put(cid, vals);
                    }
                }
            }
        } catch (Exception e) {
            System.debug(LoggingLevel.WARN, 'Contact Windfall not readable: ' + e.getMessage());
        }
        return out;
    }

    private static Map<String, String> windfallValues(SObject rec, List<String> fields) {
        Map<String, String> vals = new Map<String, String>();
        for (String f : fields) {
            if (rec.isSet(f) && rec.get(f) != null) {
                Object v = rec.get(f);
                // canvas #121: a Date must go out as yyyy-MM-dd. String.valueOf(Object) gives "2026-10-13 00:00:00",
                // which the inbox showed as "Invalid Date" (wf_net_worth_calculation_date__c is a Date field).
                vals.put(f, v instanceof Date ? String.valueOf((Date) v) : String.valueOf(v));
            }
        }
        return vals;
    }

    private static Boolean hasWindfallNumbers(Map<String, String> vals) {
        for (String k : vals.keySet()) {
            if (k != 'Windfall_Lead_Grade__c') {
                return true;
            }
        }
        return false;
    }

    // ---------------------------------------------------------------- speed (claim, first outreach, qualify)

    public class SpeedRow {
        @AuraEnabled public String name;
        /** Form Submissions created since SPEED_SINCE and claimed by this LDR. */
        @AuraEnabled public Integer claimed = 0;
        @AuraEnabled public Integer sameDay = 0;
        @AuraEnabled public Integer nextBusinessDay = 0;
        /** Created Saturday / Sunday, claimed the following Monday. */
        @AuraEnabled public Integer weekendToMonday = 0;
        /** Average hours from submission to the claimer's first Task on the Lead / Contact (null = none). */
        @AuraEnabled public Decimal avgFirstOutreachHours;
        /** Average hours from submission to Qualified (status history) or conversion (null = none). */
        @AuraEnabled public Decimal avgToQualifiedHours;
        public List<Decimal> outreach = new List<Decimal>();
        public List<Decimal> qualify = new List<Decimal>();
    }

    /**
     * Speed per LDR (canvas 9fed) for Form Submissions created since SPEED_SINCE and claimed: claim day vs created
     * day (Pacific, from ClaimedDate__c), the claimer's first Task on the person after the submission, and
     * the first move to Qualified (Lead Status / Contact Lead Funnel Status history) or Lead conversion.
     */
    @TestVisible
    private static List<SpeedRow> speedFor(Set<String> names) {
        Map<String, SpeedRow> rows = new Map<String, SpeedRow>();
        for (String n : names) {
            SpeedRow sr = new SpeedRow();
            sr.name = n;
            rows.put(n, sr);
        }
        List<SpeedRow> out = new List<SpeedRow>();
        try {
            List<Form_Submission__c> subs = [
                SELECT Id, CreatedDate, ClaimedDate__c, Claimed_By__c, Claimed_By__r.Name, Lead__c, Contact__c
                FROM Form_Submission__c
                WHERE CreatedDate >= :SPEED_SINCE AND Claimed_By__c != null AND Claimed_By__r.Name IN :names
                LIMIT 5000
            ];
            Set<Id> people = new Set<Id>();
            Set<Id> leadIds = new Set<Id>();
            Set<Id> contactIds = new Set<Id>();
            Set<Id> claimers = new Set<Id>();
            for (Form_Submission__c f : subs) {
                claimers.add(f.Claimed_By__c);
                if (f.Lead__c != null) {
                    people.add(f.Lead__c);
                    leadIds.add(f.Lead__c);
                }
                if (f.Contact__c != null) {
                    people.add(f.Contact__c);
                    contactIds.add(f.Contact__c);
                }
            }
            // The claimer's Tasks on these people since go-live, oldest first.
            Map<String, List<Datetime>> taskTimes = new Map<String, List<Datetime>>();
            if (!people.isEmpty()) {
                for (Task t : [
                    // Only the claimers' Tasks are ever looked up (key <person>:<claimer>). In production about 70% of the
                    // Tasks on these people are Eloqua Partner tracking Tasks (2026-10-21), so this cuts the rows ~3x.
                    SELECT WhoId, OwnerId, CreatedDate FROM Task
                    WHERE WhoId IN :people AND OwnerId IN :claimers AND CreatedDate >= :SPEED_SINCE
                    ORDER BY CreatedDate ASC LIMIT 20000
                ]) {
                    String k = t.WhoId + ':' + t.OwnerId;
                    if (!taskTimes.containsKey(k)) {
                        taskTimes.put(k, new List<Datetime>());
                    }
                    taskTimes.get(k).add(t.CreatedDate);
                }
            }
            // First Qualified per person (status history), and Lead conversion.
            Map<Id, List<Datetime>> qualTimes = new Map<Id, List<Datetime>>();
            if (!leadIds.isEmpty()) {
                for (LeadHistory h : [
                    SELECT LeadId, NewValue, CreatedDate FROM LeadHistory
                    WHERE LeadId IN :leadIds AND Field = 'Status' AND CreatedDate >= :SPEED_SINCE
                    ORDER BY CreatedDate ASC LIMIT 20000
                ]) {
                    if (String.valueOf(h.NewValue) == 'Qualified') {
                        addTime(qualTimes, h.LeadId, h.CreatedDate);
                    }
                }
                for (Lead l : [SELECT Id, ConvertedDate FROM Lead WHERE Id IN :leadIds AND IsConverted = true]) {
                    if (l.ConvertedDate != null) {
                        addTime(qualTimes, l.Id, Datetime.newInstance(l.ConvertedDate, Time.newInstance(12, 0, 0, 0)));
                    }
                }
            }
            if (!contactIds.isEmpty()) {
                for (ContactHistory h : [
                    SELECT ContactId, NewValue, CreatedDate FROM ContactHistory
                    WHERE ContactId IN :contactIds AND Field = 'Lead_Funnel_Status__c' AND CreatedDate >= :SPEED_SINCE
                    ORDER BY CreatedDate ASC LIMIT 20000
                ]) {
                    if (String.valueOf(h.NewValue) == 'Qualified') {
                        addTime(qualTimes, h.ContactId, h.CreatedDate);
                    }
                }
            }
            for (Form_Submission__c f : subs) {
                SpeedRow sr = rows.get(f.Claimed_By__r.Name);
                if (sr == null) {
                    continue;
                }
                sr.claimed++;
                Date created = pacificDate(f.CreatedDate);
                Date claimed = f.ClaimedDate__c == null ? null : pacificDate(f.ClaimedDate__c);
                if (claimed != null) {
                    String dow = Datetime.newInstance(created, Time.newInstance(12, 0, 0, 0)).format('E');
                    if (claimed == created) {
                        sr.sameDay++;
                    } else if ((dow == 'Sat' && claimed == created.addDays(2)) || (dow == 'Sun' && claimed == created.addDays(1))) {
                        sr.weekendToMonday++;
                    } else if (claimed == nextBusinessDay(created, dow)) {
                        sr.nextBusinessDay++;
                    }
                }
                Id person = f.Contact__c != null ? f.Contact__c : f.Lead__c;
                Datetime first = firstAfter(taskTimes.get(person + ':' + f.Claimed_By__c), f.CreatedDate);
                if (first == null && f.Lead__c != null && f.Contact__c != null) {
                    first = firstAfter(taskTimes.get(f.Lead__c + ':' + f.Claimed_By__c), f.CreatedDate);
                }
                if (first != null) {
                    sr.outreach.add(hoursBetween(f.CreatedDate, first));
                }
                Datetime q = firstAfter(qualTimes.get(person), f.CreatedDate);
                if (q == null && f.Lead__c != null) {
                    q = firstAfter(qualTimes.get(f.Lead__c), f.CreatedDate);
                }
                if (q != null) {
                    sr.qualify.add(hoursBetween(f.CreatedDate, q));
                }
            }
        } catch (Exception e) {
            System.debug(LoggingLevel.WARN, 'Speed metrics not available: ' + e.getMessage());
        }
        for (String n : names) {
            SpeedRow sr = rows.get(n);
            sr.avgFirstOutreachHours = average(sr.outreach);
            sr.avgToQualifiedHours = average(sr.qualify);
            out.add(sr);
        }
        return out;
    }

    private static void addTime(Map<Id, List<Datetime>> m, Id key, Datetime t) {
        if (!m.containsKey(key)) {
            m.put(key, new List<Datetime>());
        }
        m.get(key).add(t);
    }

    @TestVisible
    private static Datetime firstAfter(List<Datetime> times, Datetime start) {
        if (times == null) {
            return null;
        }
        Datetime best = null;
        for (Datetime t : times) {
            if (t >= start && (best == null || t < best)) {
                best = t;
            }
        }
        return best;
    }

    private static Decimal hoursBetween(Datetime a, Datetime b) {
        return Decimal.valueOf(b.getTime() - a.getTime()) / 3600000;
    }

    private static Decimal average(List<Decimal> xs) {
        if (xs.isEmpty()) {
            return null;
        }
        Decimal total = 0;
        for (Decimal x : xs) {
            total += x;
        }
        return (total / xs.size()).setScale(1);
    }

    @TestVisible
    private static Date pacificDate(Datetime d) {
        return Date.valueOf(d.format('yyyy-MM-dd', PACIFIC_TZ));
    }

    @TestVisible
    private static Date nextBusinessDay(Date d, String dow) {
        if (dow == 'Fri') {
            return d.addDays(3);
        }
        if (dow == 'Sat') {
            return d.addDays(2);
        }
        return d.addDays(1);
    }

    // ---------------------------------------------------------------- Boss View: 6Sense Dashboard

    public class SixWeek {
        @AuraEnabled public String label;
        /** 'lead' | 'contact' -> CE status -> count. */
        @AuraEnabled public Map<String, Map<String, Integer>> byObject = new Map<String, Map<String, Integer>>();
    }

    public class SixCampaign {
        @AuraEnabled public String obj;
        @AuraEnabled public String name;
        @AuraEnabled public Integer n;
    }

    public class SixReview {
        @AuraEnabled public String name;
        @AuraEnabled public Integer hrLeads = 0;
        @AuraEnabled public Integer hrContacts = 0;
        @AuraEnabled public Integer qLeads = 0;
        @AuraEnabled public Integer qContacts = 0;
    }

    public class SixSenseResult {
        @AuraEnabled public Datetime asOf;
        /** 'lead' | 'contact' -> CE status -> count, CE In Progress Time in the last 30 days. */
        @AuraEnabled public Map<String, Map<String, Integer>> last30 = new Map<String, Map<String, Integer>>();
        @AuraEnabled public List<SixWeek> weeks = new List<SixWeek>();
        @AuraEnabled public List<SixCampaign> campaigns = new List<SixCampaign>();
        @AuraEnabled public List<SixReview> review = new List<SixReview>();
        @AuraEnabled public String error;
    }

    /**
     * Boss View 6Sense Dashboard (admins, canvas 9fed), modelled on the Salesforce "6Sense Dashboard": CE enrolments
     * (CE_In_Progress_Time__c) by sixsense_ce__status__c for 30 days and by week for 8 weeks, top campaigns for 60
     * days, and Human Review / Qualified (CE_Human_Review_Time__c / CE_Qualified_Time__c) for 14 days by Project
     * Coordinator. All read dynamically; a missing field shows as an error line instead of failing.
     */
    @AuraEnabled
    public static SixSenseResult getSixSenseDashboard() {
        if (!isAdmin()) {
            throw auraError('The 6Sense dashboard is only available to the inbox admins.');
        }
        SixSenseResult r = new SixSenseResult();
        r.asOf = Datetime.now();
        Datetime d30 = Datetime.now().addDays(-30);
        Datetime d60 = Datetime.now().addDays(-60);
        Datetime d14 = Datetime.now().addDays(-14);
        Date weekStart = Date.today().toStartOfWeek().addDays(-49);
        Datetime w8 = Datetime.newInstance(weekStart, Time.newInstance(0, 0, 0, 0));
        Map<String, SixWeek> weeks = new Map<String, SixWeek>();
        for (Integer i = 0; i < 8; i++) {
            SixWeek w = new SixWeek();
            Date ws = weekStart.addDays(7 * i);
            w.label = Datetime.newInstance(ws, Time.newInstance(12, 0, 0, 0)).format('MMM d') + (i == 7 ? '*' : '');
            w.byObject.put('lead', new Map<String, Integer>());
            w.byObject.put('contact', new Map<String, Integer>());
            weeks.put(String.valueOf(ws), w);
            r.weeks.add(w);
        }
        Map<String, Object> binds = new Map<String, Object>{ 'd30' => d30, 'd60' => d60, 'd14' => d14, 'w8' => w8 };
        Map<Id, SixReview> review = new Map<Id, SixReview>();
        List<String> errors = new List<String>();
        for (String obj : new List<String>{ 'Lead', 'Contact' }) {
            String key = obj.toLowerCase();
            if (!hasField(obj, 'sixsense_ce__status__c') || !hasField(obj, 'CE_In_Progress_Time__c')) {
                errors.add(obj + ' is missing sixsense_ce__status__c or CE_In_Progress_Time__c');
                continue;
            }
            try {
                Map<String, Integer> l30 = new Map<String, Integer>();
                for (AggregateResult ag : (List<AggregateResult>) Database.queryWithBinds(
                        'SELECT sixsense_ce__status__c st, COUNT(Id) n FROM ' + obj
                        + ' WHERE CE_In_Progress_Time__c >= :d30 GROUP BY sixsense_ce__status__c', binds, AccessLevel.SYSTEM_MODE)) {
                    l30.put(String.valueOf(ag.get('st')), (Integer) ag.get('n'));
                }
                r.last30.put(key, l30);
                // By week: rows since w8, bucketed into Sunday-start weeks in Apex.
                for (AggregateResult ag : (List<AggregateResult>) Database.queryWithBinds(
                        'SELECT DAY_ONLY(convertTimezone(CE_In_Progress_Time__c)) d, sixsense_ce__status__c st, COUNT(Id) n FROM ' + obj
                        + ' WHERE CE_In_Progress_Time__c >= :w8 GROUP BY DAY_ONLY(convertTimezone(CE_In_Progress_Time__c)), sixsense_ce__status__c',
                        binds, AccessLevel.SYSTEM_MODE)) {
                    Date day = (Date) ag.get('d');
                    SixWeek w = weeks.get(String.valueOf(day.toStartOfWeek()));
                    if (w == null) {
                        continue;
                    }
                    Map<String, Integer> m = w.byObject.get(key);
                    String st = String.valueOf(ag.get('st'));
                    m.put(st, (m.containsKey(st) ? m.get(st) : 0) + (Integer) ag.get('n'));
                }
                if (hasField(obj, 'sixsense_ce__campaign_name__c')) {
                    for (AggregateResult ag : (List<AggregateResult>) Database.queryWithBinds(
                            'SELECT sixsense_ce__campaign_name__c c, COUNT(Id) n FROM ' + obj
                            + ' WHERE CE_In_Progress_Time__c >= :d60 AND sixsense_ce__campaign_name__c != null'
                            + ' GROUP BY sixsense_ce__campaign_name__c ORDER BY COUNT(Id) DESC LIMIT 10', binds, AccessLevel.SYSTEM_MODE)) {
                        SixCampaign c = new SixCampaign();
                        c.obj = key;
                        c.name = String.valueOf(ag.get('c'));
                        c.n = (Integer) ag.get('n');
                        r.campaigns.add(c);
                    }
                }
                for (String timeField : new List<String>{ 'CE_Human_Review_Time__c', 'CE_Qualified_Time__c' }) {
                    if (!hasField(obj, timeField)) {
                        continue;
                    }
                    for (AggregateResult ag : (List<AggregateResult>) Database.queryWithBinds(
                            'SELECT Project_Coordinator__c pc, COUNT(Id) n FROM ' + obj + ' WHERE ' + timeField
                            + ' >= :d14 AND Project_Coordinator__c != null GROUP BY Project_Coordinator__c', binds, AccessLevel.SYSTEM_MODE)) {
                        Id pc = (Id) ag.get('pc');
                        if (!review.containsKey(pc)) {
                            review.put(pc, new SixReview());
                        }
                        SixReview rv = review.get(pc);
                        Integer n = (Integer) ag.get('n');
                        if (timeField == 'CE_Human_Review_Time__c') {
                            if (key == 'lead') {
                                rv.hrLeads += n;
                            } else {
                                rv.hrContacts += n;
                            }
                        } else if (key == 'lead') {
                            rv.qLeads += n;
                        } else {
                            rv.qContacts += n;
                        }
                    }
                }
            } catch (Exception e) {
                errors.add(obj + ': ' + e.getMessage());
            }
        }
        if (!review.isEmpty()) {
            for (User u : [SELECT Id, Name FROM User WHERE Id IN :review.keySet()]) {
                review.get(u.Id).name = u.Name;
            }
            r.review = review.values();
        }
        r.error = errors.isEmpty() ? null : String.join(errors, ' | ');
        return r;
    }

    // ---------------------------------------------------------------- 6Sense tab (canvas #151, #152 A / K)

    /** First day of 6Sense replies: Sep 1, 2026, midnight Pacific (07:00 GMT). */
    @TestVisible static final Datetime SIX_SENSE_SINCE = Datetime.newInstanceGmt(2026, 9, 1, 7, 0, 0);
    /** Row cap per object (Task, Event), newest first; production had 275 matching Tasks on 2026-10-27. */
    @TestVisible static final Integer SIX_SENSE_LIMIT = 2000;
    @TestVisible static final String SIX_SENSE_SUBJECT = '%[6sense] [Email] [In]%';
    /**
     * The six LDRs (canvas #151 C). A Lead whose Project Coordinator is blank or anyone else (someone who left, Aziz)
     * is Unassigned. Change this when the team does: Aqil Bassa, Jabir Nana, Jahmanz Williams, Samantha Sanchez,
     * WeiWei Huang, Yasmin Hernandez.
     */
    @TestVisible static final Set<Id> SIX_SENSE_LDR_IDS = new Set<Id>{
        '005A0000008OTqWIAW', '005PY0000017MpdYAE', '005A0000000MOJRIA4',
        '005PY0000006pPdYAI', '005A0000001E1UIIA0', '005PY000000546DYAQ'
    };
    /** NanaWall staff auto-replies carry the CASL footer; Comments have a space after the comma, so \s* (canvas #151 B). */
    private static final Pattern SIX_SENSE_CASL = Pattern.compile(
        '(?i)For our Canadian contacts,\\s*per the Canadian Anti-Spam Legislation \\(CASL\\)');

    public class SixSenseReply {
        @AuraEnabled public Id id;
        /** 'Task' | 'Event' (the "Full Email in Salesforce" link). */
        @AuraEnabled public String kind;
        /** Without the "[6sense] [Email] [In] " prefix. */
        @AuraEnabled public String subject;
        @AuraEnabled public Datetime createdDate;
        /** The person's reply only (quoted thread trimmed, as on Post Quote). */
        @AuraEnabled public String body;
    }

    public class SixSensePerson {
        @AuraEnabled public Id leadId;
        @AuraEnabled public String name;
        @AuraEnabled public String email;
        @AuraEnabled public String phone;
        @AuraEnabled public String company;
        @AuraEnabled public String city;
        @AuraEnabled public String state;
        @AuraEnabled public String postalCode;
        @AuraEnabled public String status;
        @AuraEnabled public String outcome;
        @AuraEnabled public Id coordinatorId;
        @AuraEnabled public String coordinatorName;
        /** Lead owner's name; the LWC applies the owner aliases. */
        @AuraEnabled public String ownerName;
        @AuraEnabled public String leadType;
        @AuraEnabled public String leadSource;
        /** sixsense_ce__status__c API value (e.g. human_review); the LWC shows the label. */
        @AuraEnabled public String ceStatus;
        @AuraEnabled public String ceCampaign;
        @AuraEnabled public String ceCampaignStatus;
        @AuraEnabled public Date timeStamp;
        @AuraEnabled public Datetime ceStatusTime;
        /** Newest kept reply (the card's date and sort key). */
        @AuraEnabled public Datetime latestAt;
        /** Coordinator blank or not one of SIX_SENSE_LDR_IDS. */
        @AuraEnabled public Boolean unassigned = false;
        /** Kept replies, newest first. */
        @AuraEnabled public List<SixSenseReply> replies = new List<SixSenseReply>();
    }

    public class SixSenseReplyResult {
        /** People ordered by their newest reply, newest first. */
        @AuraEnabled public List<SixSensePerson> people = new List<SixSensePerson>();
        /** True when the Task or the Event query hit SIX_SENSE_LIMIT (older replies may be missing). */
        @AuraEnabled public Boolean capped = false;
        @AuraEnabled public Integer limitRows = SIX_SENSE_LIMIT;
        /** Set when the 6sense package fields are missing or a query failed; people is then empty. */
        @AuraEnabled public String error;
    }

    /** Sorts replies newest first (Task and Event rows merged). */
    private class SixSenseReplySort implements Comparable {
        public SixSenseReply reply;
        public Id leadId;
        public SixSenseReplySort(SixSenseReply reply, Id leadId) {
            this.reply = reply;
            this.leadId = leadId;
        }
        public Integer compareTo(Object other) {
            Datetime a = reply.createdDate;
            Datetime b = ((SixSenseReplySort) other).reply.createdDate;
            if (a == b) {
                return 0;
            }
            if (a == null) {
                return 1;
            }
            if (b == null) {
                return -1;
            }
            return a > b ? -1 : 1;
        }
    }

    /**
     * Canvas #151 B, the rules SOQL can't express: keep a reply only when the Lead Funnel Time Stamp is blank or earlier
     * than the reply's date (Datetime.date() = the running user's time zone, Pacific for the team), and its Comments
     * don't carry the CASL footer.
     */
    @TestVisible
    static Boolean keepSixSenseReply(Date stamp, Datetime created, String description) {
        if (stamp != null && (created == null || stamp >= created.date())) {
            return false;
        }
        return String.isBlank(description) || !SIX_SENSE_CASL.matcher(description).find();
    }

    /**
     * 6Sense tab (canvas #151, admins only per #152 A): 6sense email replies logged on Leads. Task and Event, open or
     * completed, Subject contains "[6sense] [Email] [In]", created on or after SIX_SENSE_SINCE, on a Lead whose CE
     * Campaign Name contains "rina" or "Emily"; then keepSixSenseReply. One entry per Lead, replies newest first,
     * people ordered by their newest reply. Not an admin -> an empty result (no error). Read-only, user mode. Dynamic
     * SOQL so the class compiles in an org without the 6sense package.
     */
    @AuraEnabled
    public static SixSenseReplyResult getSixSenseReplies() {
        SixSenseReplyResult r = new SixSenseReplyResult();
        if (!isAdmin()) {
            return r;
        }
        if (!hasField('Lead', 'sixsense_ce__campaign_name__c')) {
            r.error = 'This org is missing Lead.sixsense_ce__campaign_name__c (6sense package).';
            return r;
        }
        try {
            Map<String, Object> binds = new Map<String, Object>{
                'subj' => SIX_SENSE_SUBJECT, 'since' => SIX_SENSE_SINCE, 'lim' => SIX_SENSE_LIMIT,
                'rina' => '%rina%', 'emily' => '%Emily%'
            };
            String filter = ' WHERE Subject LIKE :subj AND CreatedDate >= :since AND Who.Type = \'Lead\''
                + ' AND WhoId IN (SELECT Id FROM Lead WHERE sixsense_ce__campaign_name__c LIKE :rina'
                + ' OR sixsense_ce__campaign_name__c LIKE :emily)'
                + ' ORDER BY CreatedDate DESC LIMIT :lim';
            // Step 1 without the email bodies (Description is long text, often with the whole quoted thread; 2,000 of
            // them could pass the 6 MB heap). Bodies are read in step 3, only for the replies that pass the stamp rule.
            List<SixSenseReplySort> found = new List<SixSenseReplySort>();
            for (String obj : new List<String>{ 'Task', 'Event' }) {
                List<SObject> acts = Database.queryWithBinds(
                    'SELECT Id, Subject, CreatedDate, WhoId FROM ' + obj + filter, binds, AccessLevel.USER_MODE);
                if (acts.size() >= SIX_SENSE_LIMIT) {
                    r.capped = true;
                }
                for (SObject a : acts) {
                    SixSenseReply rep = new SixSenseReply();
                    rep.id = a.Id;
                    rep.kind = obj;
                    String subj = (String) a.get('Subject');
                    rep.subject = subj == null ? '' : subj.replace('[6sense] [Email] [In] ', '').trim();
                    rep.createdDate = (Datetime) a.get('CreatedDate');
                    found.add(new SixSenseReplySort(rep, (Id) a.get('WhoId')));
                }
            }
            if (found.isEmpty()) {
                return r;
            }
            Set<Id> leadIds = new Set<Id>();
            for (SixSenseReplySort s : found) {
                leadIds.add(s.leadId);
            }
            String lf = presentPaths('Lead', new List<String>{
                'Id', 'Name', 'Email', 'Phone', 'Company', 'City', 'State', 'PostalCode', 'Status',
                'Lead_Funnel_Time_Stamp__c', 'Lead_Funnel_Outcome__c', 'Project_Coordinator__c', 'Project_Coordinator__r.Name',
                'OwnerId', 'Owner.Name', 'Type__c', 'LeadSource', 'sixsense_ce__status__c', 'sixsense_ce__campaign_name__c',
                'sixsense_ce__campaign_status__c', 'CE_Lead_Status_Time__c'
            });
            Map<Id, SObject> leads = new Map<Id, SObject>(Database.queryWithBinds(
                'SELECT ' + lf + ' FROM Lead WHERE Id IN :ids',
                new Map<String, Object>{ 'ids' => leadIds }, AccessLevel.USER_MODE));
            found.sort();
            // Step 2: the stamp rule (no body needed). Step 3: the bodies of the replies left, 200 at a time; the CASL
            // rule drops some, the rest keep only the reply part (replyOnly), not the full Description.
            List<SixSenseReplySort> kept = new List<SixSenseReplySort>();
            Map<String, Set<Id>> keptIds = new Map<String, Set<Id>>{ 'Task' => new Set<Id>(), 'Event' => new Set<Id>() };
            for (SixSenseReplySort s : found) {
                SObject l = leads.get(s.leadId);
                if (l != null && keepSixSenseReply((Date) l.get('Lead_Funnel_Time_Stamp__c'), s.reply.createdDate, null)) {
                    kept.add(s);
                    keptIds.get(s.reply.kind).add(s.reply.id);
                }
            }
            Set<Id> casl = new Set<Id>();
            Map<Id, String> bodies = new Map<Id, String>();
            for (String obj : keptIds.keySet()) {
                Set<Id> ids = keptIds.get(obj);
                if (ids.isEmpty()) {
                    continue;
                }
                for (List<SObject> chunk : Database.query('SELECT Id, Description FROM ' + obj + ' WHERE Id IN :ids WITH USER_MODE')) {
                    for (SObject a : chunk) {
                        String d = (String) a.get('Description');
                        if (!keepSixSenseReply(null, null, d)) {
                            casl.add(a.Id);
                        } else {
                            bodies.put(a.Id, replyOnly(d));
                        }
                    }
                }
            }
            Map<Id, SixSensePerson> byLead = new Map<Id, SixSensePerson>();
            for (SixSenseReplySort s : kept) {
                SObject l = leads.get(s.leadId);
                if (casl.contains(s.reply.id)) {
                    continue;
                }
                s.reply.body = bodies.get(s.reply.id);
                SixSensePerson p = byLead.get(s.leadId);
                if (p == null) {
                    p = sixSensePerson(l);
                    p.latestAt = s.reply.createdDate;
                    byLead.put(s.leadId, p);
                    r.people.add(p); // replies are sorted newest first, so people end up in newest-reply order
                }
                p.replies.add(s.reply);
            }
        } catch (Exception e) {
            r.people = new List<SixSensePerson>();
            r.error = 'Could not load the 6Sense replies: ' + e.getMessage();
        }
        return r;
    }

    private static SixSensePerson sixSensePerson(SObject l) {
        SixSensePerson p = new SixSensePerson();
        p.leadId = l.Id;
        p.name = textOf(l, 'Name');
        p.email = textOf(l, 'Email');
        p.phone = textOf(l, 'Phone');
        p.company = textOf(l, 'Company');
        p.city = textOf(l, 'City');
        p.state = textOf(l, 'State');
        p.postalCode = textOf(l, 'PostalCode');
        p.status = textOf(l, 'Status');
        p.outcome = textOf(l, 'Lead_Funnel_Outcome__c');
        p.coordinatorId = (Id) l.get('Project_Coordinator__c');
        SObject pc = l.getSObject('Project_Coordinator__r');
        p.coordinatorName = pc == null ? null : (String) pc.get('Name');
        SObject own = l.getSObject('Owner');
        p.ownerName = own == null ? null : (String) own.get('Name');
        p.leadType = textOf(l, 'Type__c');
        p.leadSource = textOf(l, 'LeadSource');
        p.ceStatus = textOf(l, 'sixsense_ce__status__c');
        p.ceCampaign = textOf(l, 'sixsense_ce__campaign_name__c');
        p.ceCampaignStatus = textOf(l, 'sixsense_ce__campaign_status__c');
        p.timeStamp = (Date) l.get('Lead_Funnel_Time_Stamp__c');
        try {
            p.ceStatusTime = l.isSet('CE_Lead_Status_Time__c') ? (Datetime) l.get('CE_Lead_Status_Time__c') : null;
        } catch (Exception e) {
            p.ceStatusTime = null; // field missing in this org
        }
        p.unassigned = p.coordinatorId == null || !SIX_SENSE_LDR_IDS.contains(p.coordinatorId);
        return p;
    }

    /**
     * 6Sense page status buttons (canvas #151 G, #152 K): Working / Nurture / Unreachable / Disqualified set Lead Status
     * and Lead Funnel Time Stamp (todayPacific() from the LWC), which takes the person off the list until they reply
     * again; the LWC's undo calls this again with the values it kept. Admins only, user mode.
     * - status: null = leave as is (Lead Status is required, so it is never cleared).
     * - outcome: null = leave as is; '' = clear; else the Lead Funnel Outcome value.
     * - timeStamp: always written; null clears it (undo to a blank stamp).
     */
    @AuraEnabled
    public static void saveSixSenseStatus(Id leadId, String status, String outcome, Date timeStamp) {
        if (!isAdmin()) {
            throw auraError('The 6Sense tab is only available to the inbox admins.');
        }
        if (leadId == null || leadId.getSObjectType() != Lead.SObjectType) {
            throw auraError('No Lead to update.');
        }
        Lead l = new Lead(Id = leadId, Lead_Funnel_Time_Stamp__c = timeStamp);
        if (status != null) {
            l.Status = status;
        }
        if (outcome != null) {
            l.Lead_Funnel_Outcome__c = String.isBlank(outcome) ? null : outcome;
        }
        try {
            Database.update(l, AccessLevel.USER_MODE);
        } catch (DmlException e) {
            throw auraError('Could not update the Lead: ' + e.getDmlMessage(0));
        } catch (Exception e) {
            throw auraError('Could not update the Lead: ' + e.getMessage());
        }
    }

    private static String joinNonBlank(List<String> parts) {
        List<String> keep = new List<String>();
        for (String p : parts) {
            if (String.isNotBlank(p)) {
                keep.add(p);
            }
        }
        return String.join(keep, ' · ');
    }

    // ---------------------------------------------------------------- Claim Audit (canvas #145B) / uncontacted claims (#146)

    /** #146 x: written to the Comments field (#156: tagField; was the end of Questions_or_Comments__c); the person leaves the alert. */
    @TestVisible static final String NO_CONTACT_TAG = '#NoContactNeeded';
    /** Outbound email Tasks (SOQL LIKE: "[" and "]" are literal). Outreach-logged; "Email:" = Outlook-logged (Jahmanz). */
    @TestVisible static final String OUTREACH_EMAIL_LIKE = '[Outreach] [Email] [Out]%';
    @TestVisible static final String LOGGED_EMAIL_LIKE = 'Email:%';
    @TestVisible static final String OUTREACH_EMAIL_PREFIX = '[Outreach] [Email] [Out] ';
    @TestVisible static final Integer CONTACT_WINDOW_HOURS = 24;
    /** Claimers left out of the audit (Aziz: test entries), and email markers of test submissions (lower case). */
    @TestVisible static final Set<String> AUDIT_EXCLUDED_CLAIMERS = new Set<String>{ 'Aziz Nana' };
    @TestVisible static final List<String> TEST_EMAIL_MARKERS = new List<String>{ 'aziznana786', '@aqiltest.com', '@testab11.com' };
    /** Oldest claim the audit reads (query rows grow ~50 claims a day). */
    @TestVisible static final Integer AUDIT_MAX_DAYS = 120;
    @TestVisible static final Integer CLAIM_READ_CAP = 5000;
    /** Tests only: the audited claimer names (default DASHBOARD_LDRS). */
    @TestVisible static Set<String> auditClaimerNames;

    public class AuditClaimerRow {
        @AuraEnabled public String claimer;
        @AuraEnabled public Integer claimed = 0;
        @AuraEnabled public Integer checked = 0;
        @AuraEnabled public Integer ok = 0;
        @AuraEnabled public Integer pending = 0;
        @AuraEnabled public Integer late = 0;
        @AuraEnabled public Integer none = 0;
        @AuraEnabled public Integer nolink = 0;

        public Decimal rate() {
            return checked == 0 ? 0 : Decimal.valueOf(late + none) / checked;
        }
    }

    public class AuditFlagRow {
        @AuraEnabled public Id key; // the submission (Record link)
        @AuraEnabled public String objectName; // Form_Submission__c | Website_Instant_Estimate__c
        @AuraEnabled public String status; // 'No email' | 'Late (>24h)'
        @AuraEnabled public String claimer;
        @AuraEnabled public String type; // 'Form Submission' | 'Instant Estimate'
        @AuraEnabled public String name;
        @AuraEnabled public String email;
        @AuraEnabled public Datetime submitted;
        @AuraEnabled public Datetime claimed;
        @AuraEnabled public Boolean claimTimeExact;
        @AuraEnabled public Datetime firstEmail;
        @AuraEnabled public String firstEmailSubject; // without the "[Outreach] [Email] [Out] " prefix
        @AuraEnabled public Decimal hoursToEmail; // from the claim, 1 dp; null when none
        @AuraEnabled public String coordinator;
        @AuraEnabled public String leadStatus;
        @AuraEnabled public String outcome;
        @AuraEnabled public String emailedBySomeoneElse;
        @AuraEnabled public String formRecordType; // 'Lead' | 'Contact' when the form came in
        @AuraEnabled public String personType; // the current record: 'Lead' | 'Contact'
        @AuraEnabled public Id personId;
        @AuraEnabled public String converted; // 'No' | 'Yes - 10/7/2026 By Aqil Bassa'
        @AuraEnabled public Id oppId;
        @AuraEnabled public String oppName;
    }

    public class ClaimAuditResult {
        @AuraEnabled public Datetime asOf;
        @AuraEnabled public String rangeLabel;
        @AuraEnabled public List<AuditClaimerRow> claimers = new List<AuditClaimerRow>(); // late-or-none rate, highest first
        @AuraEnabled public AuditClaimerRow team;
        @AuraEnabled public List<AuditFlagRow> rows = new List<AuditFlagRow>(); // newest claim first
        @AuraEnabled public Boolean capped = false;
    }

    public class UncontactedRow {
        @AuraEnabled public Id personId; // the Lead, or the Contact (contact-linked / converted)
        @AuraEnabled public String personType; // 'Lead' | 'Contact'
        @AuraEnabled public Id submissionId; // the newest claimed submission (opens in the inbox)
        @AuraEnabled public List<Id> submissionIds = new List<Id>(); // every claimed submission of the person (x tags them all)
        @AuraEnabled public String name;
        @AuraEnabled public String form;
        @AuraEnabled public String customerType;
        @AuraEnabled public String status;
        @AuraEnabled public Boolean isEstimate = false;
        @AuraEnabled public Datetime claimedAt;
        @AuraEnabled public Boolean claimTimeExact = false;
    }

    /** One claimed submission, the same shape for Form_Submission__c and Website_Instant_Estimate__c. */
    @TestVisible
    private class ClaimItem {
        public Id id;
        public String objectName;
        public Id claimerId;
        public String claimerName;
        public String name;
        public String email;
        public String form;
        public String customerType;
        public Datetime submitted;
        public Id leadId;
        public Id contactId; // Contact__c, else the converted Lead's Contact
        public Id personId;
        public Datetime claimAt;
        public Boolean exact = false;
        public Boolean junk = false;
        public Boolean testRow = false;
        public Boolean noContactTag = false;
        public String coordinator;
        public String leadStatus;
        public String outcome;
        public Boolean leadConverted = false;
        public Date leadConvertedDate;
    }

    /**
     * Claimed submissions (Representative forms left out) claimed on or after fromDate (Pacific; ClaimedDate__c, #156);
     * optionally one claimer.
     */
    @TestVisible
    private static List<ClaimItem> readClaims(Date fromDate, Id onlyClaimer, Integer cap) {
        List<ClaimItem> out = new List<ClaimItem>();
        List<String> objects = new List<String>{ 'Form_Submission__c' };
        if (estimatesClaimable()) {
            objects.add(ESTIMATE_OBJECT);
        }
        for (String obj : objects) {
            Boolean isFs = obj == 'Form_Submission__c';
            List<String> paths = new List<String>{
                'Id', 'CreatedDate', 'First_Name__c', 'Last_Name__c', 'Email_Address__c', 'Customer_Type__c', 'Questions_or_Comments__c',
                'Claimed_By__c', 'Claimed_By__r.Name', CLAIMED_AT, 'Lead__c', 'Lead__r.Name', 'Lead__r.Status',
                'Lead__r.Lead_Funnel_Outcome__c', 'Lead__r.Project_Coordinator__r.Name', 'Lead__r.Type__c', 'Lead__r.IsConverted',
                'Lead__r.ConvertedContactId', 'Lead__r.ConvertedDate', 'Contact__c', 'Contact__r.Name', 'Contact__r.Lead_Funnel_Status__c',
                'Contact__r.Lead_Funnel_Outcome__c', 'Contact__r.Project_Coordinator__r.Name', tagField(obj), legacyTagField(obj)
            };
            if (isFs) {
                paths.addAll(new List<String>{ 'Submit_Time__c', 'Type__c', 'Inquiry_Type__c' });
            }
            String soql = 'SELECT ' + presentPaths(obj, new List<String>(new Set<String>(paths))) + ' FROM ' + obj
                + ' WHERE Claimed_By__c != null AND ' + CLAIMED_AT + ' >= :f'
                + (onlyClaimer != null ? ' AND Claimed_By__c = :who' : '')
                + (isFs ? ' AND (Inquiry_Type__c = null OR Inquiry_Type__c NOT IN :ex)' : '')
                + ' ORDER BY ' + CLAIMED_AT + ' DESC LIMIT ' + cap;
            Map<String, Object> binds = new Map<String, Object>{ 'f' => pacificDatetime(fromDate, 0) };
            if (onlyClaimer != null) {
                binds.put('who', onlyClaimer);
            }
            if (isFs) {
                binds.put('ex', EXCLUDED_INQUIRIES);
            }
            for (SObject s : Database.queryWithBinds(soql, binds, AccessLevel.SYSTEM_MODE)) {
                out.add(claimItem(s, obj));
            }
        }
        return out;
    }

    private static ClaimItem claimItem(SObject s, String obj) {
        Boolean isFs = obj == 'Form_Submission__c';
        ClaimItem c = new ClaimItem();
        c.id = s.Id;
        c.objectName = obj;
        c.claimerId = (Id) pathValue(s, 'Claimed_By__c');
        c.claimerName = pathText(s, 'Claimed_By__r.Name');
        String full = ((pathText(s, 'First_Name__c') == null ? '' : pathText(s, 'First_Name__c')) + ' '
            + (pathText(s, 'Last_Name__c') == null ? '' : pathText(s, 'Last_Name__c'))).trim();
        c.leadId = (Id) pathValue(s, 'Lead__c');
        Id fsContact = (Id) pathValue(s, 'Contact__c');
        c.contactId = effectiveContactId(s);
        c.personId = c.contactId != null ? c.contactId : c.leadId;
        c.name = String.isNotBlank(full) ? full : pathText(s, fsContact != null ? 'Contact__r.Name' : 'Lead__r.Name');
        c.email = pathText(s, 'Email_Address__c');
        Datetime submitTime = isFs ? (Datetime) pathValue(s, 'Submit_Time__c') : null;
        c.submitted = submitTime != null ? submitTime : (Datetime) pathValue(s, 'CreatedDate');
        // #156: the claim time itself. Claims made before ClaimedDate__c existed were backfilled to midnight Pacific
        // (Aqil, 2026-10-29: accepted); those count as date-only in Claim Audit.
        c.claimAt = (Datetime) pathValue(s, CLAIMED_AT);
        c.exact = c.claimAt != null && c.claimAt.format('HH:mm:ss', PACIFIC_TZ) != '00:00:00';
        if (isFs) {
            String t = pathText(s, 'Type__c');
            String inq = pathText(s, 'Inquiry_Type__c');
            c.form = String.isNotBlank(t) ? t : String.isNotBlank(inq) ? inq : 'Form';
        } else {
            c.form = 'Instant Estimate';
        }
        String leadType = pathText(s, 'Lead__r.Type__c');
        c.customerType = String.isNotBlank(leadType) ? leadType : pathText(s, 'Customer_Type__c');
        // #156: the automation tags (new Comments field, plus the old place until the one-time move has run).
        // #NoContactNeeded used to go at the end of Questions or Comments on form submissions too.
        String fsQc = isFs ? pathText(s, 'Questions_or_Comments__c') : null;
        String tags = tagText(s, obj) + (fsQc == null ? '' : ' ' + fsQc);
        c.junk = tags.contains(JUNK_TAG);
        String em = c.email == null ? '' : c.email.toLowerCase();
        for (String m : TEST_EMAIL_MARKERS) {
            c.testRow = c.testRow || em.contains(m);
        }
        c.testRow = c.testRow || tags.contains(JUNK_TAG + 'Test submission');
        c.noContactTag = tags.contains(NO_CONTACT_TAG);
        String p = fsContact != null ? 'Contact__r.' : 'Lead__r.';
        c.coordinator = pathText(s, p + 'Project_Coordinator__r.Name');
        c.leadStatus = pathText(s, fsContact != null ? 'Contact__r.Lead_Funnel_Status__c' : 'Lead__r.Status');
        c.outcome = pathText(s, p + 'Lead_Funnel_Outcome__c');
        c.leadConverted = pathValue(s, 'Lead__r.IsConverted') == true;
        c.leadConvertedDate = (Date) pathValue(s, 'Lead__r.ConvertedDate');
        return c;
    }

    /** Converted Leads whose Contact is one of these: Contact Id -> Lead (Id, ConvertedDate). One query. */
    private static Map<Id, Lead> leadsConvertedInto(Set<Id> contactIds) {
        Map<Id, Lead> out = new Map<Id, Lead>();
        if (contactIds.isEmpty()) {
            return out;
        }
        for (Lead l : [
            SELECT Id, ConvertedContactId, ConvertedDate
            FROM Lead
            WHERE IsConverted = true AND ConvertedContactId IN :contactIds
            ORDER BY ConvertedDate ASC
            LIMIT 10000
        ]) {
            out.put(l.ConvertedContactId, l);
        }
        return out;
    }

    /** The instant whose Pacific wall-clock time is <d> <hour>:00. */
    @TestVisible
    private static Datetime pacificDatetime(Date d, Integer hour) {
        Datetime naive = Datetime.newInstanceGmt(d, Time.newInstance(hour, 0, 0, 0));
        Integer offsetMs = TimeZone.getTimeZone(PACIFIC_TZ).getOffset(naive);
        return naive.addSeconds(-offsetMs / 1000);
    }

    /** The Lead / Contact Ids a claim's emails can be on: the person, the Lead, the Lead converted into the Contact. */
    private static Set<Id> whoSet(ClaimItem c, Map<Id, Lead> leadOfContact) {
        Set<Id> out = new Set<Id>();
        Lead conv = c.contactId == null ? null : leadOfContact.get(c.contactId);
        for (Id i : new List<Id>{ c.personId, c.leadId, c.contactId, conv == null ? null : conv.Id }) {
            if (i != null) {
                out.add(i);
            }
        }
        return out;
    }

    /** Outbound email Tasks on these people since <since>, oldest first, by WhoId (only one owner when given). One query. */
    private static Map<Id, List<Task>> emailTasks(Set<Id> whoIds, Datetime since, Id onlyOwner) {
        Map<Id, List<Task>> out = new Map<Id, List<Task>>();
        if (whoIds.isEmpty()) {
            return out;
        }
        String soql = 'SELECT WhoId, OwnerId, Owner.Name, Subject, CreatedDate FROM Task'
            + ' WHERE WhoId IN :whoIds AND CreatedDate >= :since AND (Subject LIKE :a OR Subject LIKE :b)'
            + (onlyOwner != null ? ' AND OwnerId = :owner' : '')
            + ' ORDER BY CreatedDate ASC LIMIT 20000';
        Map<String, Object> binds = new Map<String, Object>{
            'whoIds' => whoIds, 'since' => since, 'a' => OUTREACH_EMAIL_LIKE, 'b' => LOGGED_EMAIL_LIKE
        };
        if (onlyOwner != null) {
            binds.put('owner', onlyOwner);
        }
        for (Task t : (List<Task>) Database.queryWithBinds(soql, binds, AccessLevel.SYSTEM_MODE)) {
            if (!out.containsKey(t.WhoId)) {
                out.put(t.WhoId, new List<Task>());
            }
            out.get(t.WhoId).add(t);
        }
        return out;
    }

    /** The earliest email Task on the claim's people since the submission, by the claimer (mine) or by anyone else. */
    private static Task firstEmail(ClaimItem c, Set<Id> who, Map<Id, List<Task>> tasks, Boolean mine) {
        Task first;
        for (Id w : who) {
            for (Task t : tasks.containsKey(w) ? tasks.get(w) : new List<Task>()) {
                if (t.CreatedDate < c.submitted || (t.OwnerId == c.claimerId) != mine) {
                    continue;
                }
                if (first == null || t.CreatedDate < first.CreatedDate) {
                    first = t;
                }
                break; // the lists are oldest first; later matches for this person can't be earlier
            }
        }
        return first;
    }

    /**
     * canvas #145B Claim Audit (Boss View): every LDR's claims since fromDate (default Oct 6, 2026; at most AUDIT_MAX_DAYS
     * back) and the claimer's first outbound email after it. Totals per claimer + the flagged rows (no email / late).
     * Salesforce data only. Read-only; about 8 queries.
     */
    @AuraEnabled
    public static ClaimAuditResult getClaimAudit(Date fromDate) {
        if (!isAdmin()) {
            throw auraError('The claim audit is only available to the inbox admins.');
        }
        Date today = pacificDate(Datetime.now());
        Date f = fromDate != null ? fromDate : pacificDate(SPEED_SINCE);
        if (f < today.addDays(-AUDIT_MAX_DAYS)) {
            f = today.addDays(-AUDIT_MAX_DAYS);
        }
        ClaimAuditResult r = new ClaimAuditResult();
        r.asOf = Datetime.now();
        r.rangeLabel = pacificDatetime(f, 12).format('MMM d', PACIFIC_TZ) + ' – ' + Datetime.now().format('MMM d, yyyy', PACIFIC_TZ);
        Set<String> audited = auditClaimerNames != null ? auditClaimerNames : new Set<String>(DASHBOARD_LDRS);
        List<ClaimItem> all = readClaims(f, null, CLAIM_READ_CAP);
        r.capped = all.size() >= CLAIM_READ_CAP;
        List<ClaimItem> items = new List<ClaimItem>();
        Set<Id> leadIds = new Set<Id>();
        Set<Id> contactIds = new Set<Id>();
        Datetime earliest;
        for (ClaimItem c : all) {
            if (!audited.contains(c.claimerName) || AUDIT_EXCLUDED_CLAIMERS.contains(c.claimerName) || c.testRow) {
                continue;
            }
            items.add(c);
            if (c.leadId != null) {
                leadIds.add(c.leadId);
            }
            if (c.contactId != null) {
                contactIds.add(c.contactId);
            }
            if (earliest == null || c.submitted < earliest) {
                earliest = c.submitted;
            }
        }
        r.team = new AuditClaimerRow();
        r.team.claimer = 'Whole team';
        if (items.isEmpty()) {
            return r;
        }
        Map<Id, Lead> leadOfContact = leadsConvertedInto(contactIds);
        for (Lead l : leadOfContact.values()) {
            leadIds.add(l.Id);
        }
        Map<Id, String> converterOf = new Map<Id, String>();
        try {
            for (ContactHistory h : [
                SELECT ContactId, CreatedBy.Name
                FROM ContactHistory
                WHERE ContactId IN :contactIds AND Field IN ('contactCreatedFromLead', 'contactUpdatedByLead')
                ORDER BY CreatedDate ASC
                LIMIT 10000
            ]) {
                converterOf.put(h.ContactId, h.CreatedBy == null ? '' : h.CreatedBy.Name);
            }
        } catch (Exception e) {
            System.debug(LoggingLevel.WARN, 'Conversion history not readable: ' + e.getMessage());
        }
        Set<Id> whoIds = new Set<Id>(leadIds);
        whoIds.addAll(contactIds);
        Map<Id, List<Task>> tasks = emailTasks(whoIds, earliest, null);
        Map<Id, List<OpportunityContactRole>> oppsOf = new Map<Id, List<OpportunityContactRole>>();
        for (OpportunityContactRole ocr : [
            SELECT ContactId, OpportunityId, Opportunity.Name, Opportunity.CreatedDate
            FROM OpportunityContactRole
            WHERE ContactId IN :contactIds AND Opportunity.CreatedDate >= :earliest.addDays(-30)
            ORDER BY Opportunity.CreatedDate DESC
            LIMIT 10000
        ]) {
            if (!oppsOf.containsKey(ocr.ContactId)) {
                oppsOf.put(ocr.ContactId, new List<OpportunityContactRole>());
            }
            oppsOf.get(ocr.ContactId).add(ocr);
        }

        Map<String, AuditClaimerRow> byClaimer = new Map<String, AuditClaimerRow>();
        Datetime now = Datetime.now();
        for (ClaimItem c : items) {
            String who = c.claimerName == null ? '(unknown)' : c.claimerName;
            if (!byClaimer.containsKey(who)) {
                AuditClaimerRow nr = new AuditClaimerRow();
                nr.claimer = who;
                byClaimer.put(who, nr);
            }
            List<AuditClaimerRow> counters = new List<AuditClaimerRow>{ byClaimer.get(who), r.team };
            for (AuditClaimerRow x : counters) {
                x.claimed++;
            }
            if (c.personId == null || c.claimAt == null) {
                for (AuditClaimerRow x : counters) {
                    x.nolink++;
                }
                continue;
            }
            for (AuditClaimerRow x : counters) {
                x.checked++;
            }
            Set<Id> people = whoSet(c, leadOfContact);
            Task first = firstEmail(c, people, tasks, true);
            String status;
            Decimal hours;
            if (first != null) {
                hours = Decimal.valueOf(first.CreatedDate.getTime() - c.claimAt.getTime()) / 3600000;
                status = hours <= CONTACT_WINDOW_HOURS ? 'ok' : 'late';
            } else {
                status = now.getTime() - c.claimAt.getTime() < CONTACT_WINDOW_HOURS * 3600000L ? 'pending' : 'none';
            }
            for (AuditClaimerRow x : counters) {
                if (status == 'ok') {
                    x.ok++;
                } else if (status == 'late') {
                    x.late++;
                } else if (status == 'pending') {
                    x.pending++;
                } else {
                    x.none++;
                }
            }
            if (status == 'late' || status == 'none') {
                r.rows.add(auditFlagRow(c, status, first, hours, people, tasks, leadOfContact, converterOf, oppsOf));
            }
        }
        // claimers by late-or-none rate, highest first (insertion sort; a handful of rows)
        for (AuditClaimerRow x : byClaimer.values()) {
            Integer i = 0;
            while (i < r.claimers.size() && r.claimers[i].rate() >= x.rate()) {
                i++;
            }
            if (i == r.claimers.size()) {
                r.claimers.add(x);
            } else {
                r.claimers.add(i, x);
            }
        }
        sortFlagRows(r.rows);
        return r;
    }

    private static AuditFlagRow auditFlagRow(ClaimItem c, String status, Task first, Decimal hours, Set<Id> people,
            Map<Id, List<Task>> tasks, Map<Id, Lead> leadOfContact, Map<Id, String> converterOf,
            Map<Id, List<OpportunityContactRole>> oppsOf) {
        AuditFlagRow f = new AuditFlagRow();
        f.key = c.id;
        f.objectName = c.objectName;
        f.status = status == 'late' ? 'Late (>24h)' : 'No email';
        f.claimer = c.claimerName;
        f.type = c.objectName == ESTIMATE_OBJECT ? 'Instant Estimate' : 'Form Submission';
        f.name = c.name;
        f.email = c.email;
        f.submitted = c.submitted;
        f.claimed = c.claimAt;
        f.claimTimeExact = c.exact;
        if (first != null) {
            f.firstEmail = first.CreatedDate;
            f.firstEmailSubject = first.Subject == null ? '' : first.Subject.removeStart(OUTREACH_EMAIL_PREFIX);
            f.hoursToEmail = hours.setScale(1);
        }
        f.coordinator = c.coordinator;
        f.leadStatus = c.leadStatus;
        f.outcome = c.outcome;
        Task other = firstEmail(c, people, tasks, false);
        if (other != null) {
            f.emailedBySomeoneElse = (other.Owner == null ? '' : other.Owner.Name + ' ') + other.CreatedDate.format('M/d hh:mm a', PACIFIC_TZ);
        }
        Lead conv = c.contactId == null ? null : leadOfContact.get(c.contactId);
        Date convDate = c.leadConverted ? c.leadConvertedDate : conv == null ? null : conv.ConvertedDate;
        Boolean convertedAfter = convDate != null && convDate >= pacificDate(c.submitted);
        f.formRecordType = c.leadId != null || convertedAfter ? 'Lead' : 'Contact';
        f.personType = c.contactId != null ? 'Contact' : 'Lead';
        f.personId = c.personId;
        if (convertedAfter) {
            String converter = c.contactId == null ? null : converterOf.get(c.contactId);
            f.converted = 'Yes - ' + convDate.month() + '/' + convDate.day() + '/' + convDate.year()
                + (String.isNotBlank(converter) ? ' By ' + converter : '');
        } else {
            f.converted = 'No';
        }
        Datetime oppFrom = c.submitted.addDays(-30);
        for (OpportunityContactRole ocr : c.contactId != null && oppsOf.containsKey(c.contactId) ? oppsOf.get(c.contactId) : new List<OpportunityContactRole>()) {
            if (ocr.Opportunity != null && ocr.Opportunity.CreatedDate >= oppFrom) {
                f.oppId = ocr.OpportunityId;
                f.oppName = ocr.Opportunity.Name;
                break; // newest first
            }
        }
        return f;
    }

    /** Newest claim first. */
    private static void sortFlagRows(List<AuditFlagRow> rows) {
        for (Integer i = 1; i < rows.size(); i++) {
            AuditFlagRow x = rows[i];
            Integer j = i - 1;
            while (j >= 0 && rows[j].claimed < x.claimed) {
                rows[j + 1] = rows[j];
                j--;
            }
            rows[j + 1] = x;
        }
    }

    /**
     * canvas #146: the user's claimed Leads / Contacts (not junk) with no outbound email from them, 24+ hours after the
     * claim. One row per person, oldest claim first; a person with "#NoContactNeeded" on any claimed submission is left
     * out. userId = the "View as" user (admins); others get their own. Read-only; about 6 queries.
     */
    @AuraEnabled
    public static List<UncontactedRow> getUncontactedClaims(Id userId) {
        Id who = userId == null ? UserInfo.getUserId() : userId;
        if (who != UserInfo.getUserId() && !isAdmin()) {
            throw auraError('You can only see your own claims.');
        }
        List<UncontactedRow> out = new List<UncontactedRow>();
        Map<Id, List<ClaimItem>> byPerson = new Map<Id, List<ClaimItem>>();
        Set<Id> tagged = new Set<Id>();
        Set<Id> leadIds = new Set<Id>();
        Set<Id> contactIds = new Set<Id>();
        Datetime earliest;
        for (ClaimItem c : readClaims(pacificDate(SPEED_SINCE), who, 2000)) {
            if (c.personId == null || c.junk) {
                continue;
            }
            if (c.noContactTag) {
                tagged.add(c.personId);
            }
            if (!byPerson.containsKey(c.personId)) {
                byPerson.put(c.personId, new List<ClaimItem>());
            }
            byPerson.get(c.personId).add(c);
            if (c.leadId != null) {
                leadIds.add(c.leadId);
            }
            if (c.contactId != null) {
                contactIds.add(c.contactId);
            }
            if (earliest == null || c.submitted < earliest) {
                earliest = c.submitted;
            }
        }
        for (Id p : tagged) {
            byPerson.remove(p);
        }
        if (byPerson.isEmpty()) {
            return out;
        }
        Map<Id, Lead> leadOfContact = leadsConvertedInto(contactIds);
        for (Lead l : leadOfContact.values()) {
            leadIds.add(l.Id);
        }
        List<ClaimItem> items = new List<ClaimItem>();
        for (List<ClaimItem> g : byPerson.values()) {
            items.addAll(g);
        }
        Set<Id> whoIds = new Set<Id>(leadIds);
        whoIds.addAll(contactIds);
        Map<Id, List<Task>> tasks = emailTasks(whoIds, earliest, who);
        Long dayAgo = Datetime.now().getTime() - CONTACT_WINDOW_HOURS * 3600000L;
        for (List<ClaimItem> g : byPerson.values()) {
            ClaimItem newest;
            Datetime firstSubmitted;
            Set<Id> people = new Set<Id>();
            for (ClaimItem c : g) {
                people.addAll(whoSet(c, leadOfContact));
                if (firstSubmitted == null || c.submitted < firstSubmitted) {
                    firstSubmitted = c.submitted;
                }
                if (c.claimAt != null && c.claimAt.getTime() <= dayAgo && (newest == null || c.claimAt > newest.claimAt)) {
                    newest = c;
                }
            }
            if (newest == null) {
                continue; // every claim is under 24 hours old
            }
            Boolean contacted = false;
            for (Id w : people) {
                for (Task t : tasks.containsKey(w) ? tasks.get(w) : new List<Task>()) {
                    contacted = contacted || t.CreatedDate >= firstSubmitted;
                }
            }
            if (contacted) {
                continue;
            }
            UncontactedRow u = new UncontactedRow();
            u.personId = newest.personId;
            u.personType = newest.contactId != null ? 'Contact' : 'Lead';
            u.submissionId = newest.id;
            for (ClaimItem c : g) {
                u.submissionIds.add(c.id);
            }
            u.name = newest.name;
            u.form = newest.form;
            u.customerType = newest.customerType;
            u.status = newest.leadStatus;
            u.isEstimate = newest.objectName == ESTIMATE_OBJECT;
            u.claimedAt = newest.claimAt;
            u.claimTimeExact = newest.exact;
            Integer i = 0;
            while (i < out.size() && out[i].claimedAt <= u.claimedAt) {
                i++;
            }
            if (i == out.size()) {
                out.add(u);
            } else {
                out.add(i, u);
            }
        }
        return out;
    }

    /**
     * canvas #146 x "Email not needed": "#NoContactNeeded" added to the Comments field (#156: tagField) on each
     * given submission (form submissions and instant estimates) claimed by the running user (admins: any). User mode.
     * Rows that already have it are skipped. Returns how many were tagged.
     */
    @AuraEnabled
    public static Integer markNoContactNeeded(List<Id> submissionIds) {
        if (submissionIds == null || submissionIds.isEmpty()) {
            return 0;
        }
        Map<String, List<Id>> byObject = new Map<String, List<Id>>();
        for (Id i : submissionIds) {
            String obj = i == null ? null : String.valueOf(i.getSObjectType());
            if (obj != 'Form_Submission__c' && obj != ESTIMATE_OBJECT) {
                continue;
            }
            if (!hasField(obj, tagField(obj)) || !hasField(obj, 'Claimed_By__c')) {
                throw auraError(obj + '.' + tagField(obj) + ' or Claimed_By__c is missing in this org.');
            }
            if (!byObject.containsKey(obj)) {
                byObject.put(obj, new List<Id>());
            }
            byObject.get(obj).add(i);
        }
        Id me = UserInfo.getUserId();
        Boolean admin = isAdmin();
        List<SObject> upds = new List<SObject>();
        Integer found = 0;
        for (String obj : byObject.keySet()) {
            String fld = tagField(obj);
            for (SObject r : Database.queryWithBinds(
                    'SELECT Id, Claimed_By__c' + tagSelect(obj) + ' FROM ' + obj + ' WHERE Id IN :ids LIMIT 500',
                    new Map<String, Object>{ 'ids' => byObject.get(obj) }, AccessLevel.USER_MODE)) {
                if ((Id) r.get('Claimed_By__c') != me && !admin) {
                    continue;
                }
                found++;
                if (tagText(r, obj).contains(NO_CONTACT_TAG)) {
                    continue;
                }
                SObject u = r.getSObjectType().newSObject(r.Id);
                u.put(fld, withTagOrFail((String) r.get(fld), NO_CONTACT_TAG));
                upds.add(u);
            }
        }
        if (found == 0) {
            throw auraError('Submission not found, not visible to you, or not claimed by you.');
        }
        try {
            Database.update(upds, AccessLevel.USER_MODE);
        } catch (DmlException e) {
            throw auraError('Could not mark it: ' + e.getDmlMessage(0));
        } catch (Exception e) {
            throw auraError('Could not mark it: ' + e.getMessage());
        }
        return upds.size();
    }

    // ---------------------------------------------------------------- Salesforce search (canvas #144 / #145A)

    @TestVisible static final Integer PEOPLE_LIMIT = 20;
    @TestVisible static final String EMAIL_PATTERN = '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$';
    static final List<String> PEOPLE_LEAD_FIELDS = new List<String>{
        'Id', 'Name', 'Email', 'Phone', 'MobilePhone', 'Company', 'Status', 'Type__c', 'Owner.Name', 'Project_Coordinator__c',
        'Project_Coordinator__r.Name', 'City', 'State', 'PostalCode', 'CreatedDate', 'LastActivityDate'
    };
    static final List<String> PEOPLE_CONTACT_FIELDS = new List<String>{
        'Id', 'Name', 'Email', 'Phone', 'MobilePhone', 'AccountId', 'Account.Name', 'Lead_Funnel_Status__c', 'LeadType__c', 'Owner.Name',
        'Project_Coordinator__c', 'Project_Coordinator__r.Name', 'MailingCity', 'MailingState', 'MailingPostalCode', 'CreatedDate',
        'LastActivityDate'
    };

    /** A Lead (not converted) or Contact found by the Salesforce search. */
    public class PersonHit {
        @AuraEnabled public Id id;
        @AuraEnabled public String kind; // 'Lead' | 'Contact'
        @AuraEnabled public String name;
        @AuraEnabled public String email;
        @AuraEnabled public String phone;
        @AuraEnabled public String company; // Lead.Company / Contact Account.Name
        @AuraEnabled public Id accountId;
        @AuraEnabled public String customerType; // Lead.Type__c / Contact.LeadType__c
        @AuraEnabled public String status; // Lead.Status / Contact.Lead_Funnel_Status__c
        @AuraEnabled public String owner; // raw; the LWC applies the owner aliases
        @AuraEnabled public Id coordinatorId;
        @AuraEnabled public String coordinator;
        @AuraEnabled public String city;
        @AuraEnabled public String state;
        @AuraEnabled public String zip;
        @AuraEnabled public Datetime createdDate;
        @AuraEnabled public Date lastActivityDate;
        @AuraEnabled public Integer openOppCount = 0;
        @AuraEnabled public List<String> openOppStages = new List<String>(); // distinct, newest opp first
        /** Latest Form_Submission__c / Website_Instant_Estimate__c on this record (for "Not in the inbox: …"). */
        @AuraEnabled public Datetime lastSubmissionAt;
        @AuraEnabled public Boolean lastSubmissionClaimed = false;
        @AuraEnabled public Integer submissionCount = 0;
    }

    public class PeopleSearchResult {
        @AuraEnabled public List<PersonHit> people = new List<PersonHit>();
        @AuraEnabled public Boolean exact = false;
        @AuraEnabled public Boolean capped = false;
        /** A side query failed (opportunities / submissions); the hits are still returned. */
        @AuraEnabled public String error;
    }

    /**
     * canvas #144: find any Lead (IsConverted = false) or Contact. A full email = exact match on the indexed Email field
     * (sees records created seconds ago); anything else = SOSL (search index lag: new records may be missing for a few
     * minutes), kept only when the name, email or company contains the text. User mode: only records the LDR can see.
     * Read-only; up to 5 queries (people, open opportunities, the two submission objects); runs on Search / Enter only.
     */
    @AuraEnabled
    public static PeopleSearchResult searchPeople(String term) {
        String t = term == null ? '' : term.trim();
        if (t.length() < 2) {
            throw auraError('Type at least 2 characters to search Salesforce.');
        }
        t = t.left(80);
        PeopleSearchResult r = new PeopleSearchResult();
        r.exact = Pattern.matches(EMAIL_PATTERN, t);
        String lf = presentPaths('Lead', PEOPLE_LEAD_FIELDS);
        String cf = presentPaths('Contact', PEOPLE_CONTACT_FIELDS);
        List<SObject> leads;
        List<SObject> contacts;
        try {
            if (r.exact) {
                Map<String, Object> binds = new Map<String, Object>{ 't' => t };
                String lim = ' ORDER BY LastModifiedDate DESC LIMIT ' + (PEOPLE_LIMIT + 1);
                leads = Database.queryWithBinds('SELECT ' + lf + ' FROM Lead WHERE Email = :t AND IsConverted = false' + lim,
                    binds, AccessLevel.USER_MODE);
                contacts = Database.queryWithBinds('SELECT ' + cf + ' FROM Contact WHERE Email = :t' + lim, binds, AccessLevel.USER_MODE);
            } else if (soslEscape(t).length() < 2) {
                leads = new List<SObject>(); // only reserved characters: nothing SOSL can look for
                contacts = new List<SObject>();
            } else {
                Integer n = PEOPLE_LIMIT * 2; // headroom for the contains() filter below
                List<List<SObject>> found = Search.query('FIND \'' + soslEscape(t) + '*\' IN ALL FIELDS RETURNING'
                    + ' Lead(' + lf + ' WHERE IsConverted = false ORDER BY LastModifiedDate DESC LIMIT ' + n + '),'
                    + ' Contact(' + cf + ' ORDER BY LastModifiedDate DESC LIMIT ' + n + ')', AccessLevel.USER_MODE);
                leads = keepContaining(found[0], t, new List<String>{ 'Name', 'Email', 'Company' });
                contacts = keepContaining(found[1], t, new List<String>{ 'Name', 'Email', 'Account.Name' });
            }
        } catch (Exception e) {
            throw auraError('Salesforce search failed: ' + e.getMessage());
        }
        r.capped = leads.size() > PEOPLE_LIMIT || contacts.size() > PEOPLE_LIMIT;
        Map<Id, PersonHit> byId = new Map<Id, PersonHit>();
        for (Integer i = 0; i < Math.min(contacts.size(), PEOPLE_LIMIT); i++) {
            byId.put(contacts[i].Id, personHit(contacts[i], 'Contact'));
        }
        for (Integer i = 0; i < Math.min(leads.size(), PEOPLE_LIMIT); i++) {
            byId.put(leads[i].Id, personHit(leads[i], 'Lead'));
        }
        List<String> errors = new List<String>();
        addOpenOpps(byId, errors);
        addSubmissionInfo(byId, 'Form_Submission__c', 'Submit_Time__c', errors);
        addSubmissionInfo(byId, ESTIMATE_OBJECT, null, errors);
        r.people = byId.values();
        r.error = errors.isEmpty() ? null : String.join(errors, ' | ');
        return r;
    }

    private static PersonHit personHit(SObject s, String kind) {
        Boolean isC = kind == 'Contact';
        PersonHit p = new PersonHit();
        p.id = s.Id;
        p.kind = kind;
        p.name = pathText(s, 'Name');
        p.email = pathText(s, 'Email');
        p.phone = String.isNotBlank(pathText(s, 'Phone')) ? pathText(s, 'Phone') : pathText(s, 'MobilePhone');
        p.company = pathText(s, isC ? 'Account.Name' : 'Company');
        p.accountId = isC ? (Id) pathValue(s, 'AccountId') : null;
        p.customerType = pathText(s, isC ? 'LeadType__c' : 'Type__c');
        p.status = pathText(s, isC ? 'Lead_Funnel_Status__c' : 'Status');
        p.owner = pathText(s, 'Owner.Name');
        p.coordinatorId = (Id) pathValue(s, 'Project_Coordinator__c');
        p.coordinator = pathText(s, 'Project_Coordinator__r.Name');
        p.city = pathText(s, isC ? 'MailingCity' : 'City');
        p.state = pathText(s, isC ? 'MailingState' : 'State');
        p.zip = pathText(s, isC ? 'MailingPostalCode' : 'PostalCode');
        p.createdDate = (Datetime) pathValue(s, 'CreatedDate');
        p.lastActivityDate = (Date) pathValue(s, 'LastActivityDate');
        return p;
    }

    /** Value at a field path ("Owner.Name"); null when a part is missing, unset or not queried. */
    private static Object pathValue(SObject s, String path) {
        try {
            List<String> parts = path.split('\\.');
            SObject cur = s;
            for (Integer i = 0; i < parts.size() - 1; i++) {
                cur = cur == null ? null : cur.getSObject(parts[i]);
            }
            String last = parts[parts.size() - 1];
            return cur != null && cur.isSet(last) ? cur.get(last) : null;
        } catch (Exception e) {
            return null;
        }
    }

    private static String pathText(SObject s, String path) {
        Object v = pathValue(s, path);
        return v == null ? null : String.valueOf(v);
    }

    /** SOSL hits whose name / email / company contains the text (case-insensitive), so results match the mode line. */
    private static List<SObject> keepContaining(List<SObject> rows, String t, List<String> paths) {
        String q = t.toLowerCase();
        List<SObject> out = new List<SObject>();
        for (SObject s : rows) {
            for (String p : paths) {
                String v = pathText(s, p);
                if (v != null && v.toLowerCase().contains(q)) {
                    out.add(s);
                    break;
                }
            }
        }
        return out;
    }

    /**
     * The text for FIND '...': SOSL reserved characters become spaces (a backslash escape such as \( is rejected
     * inside the quotes) and apostrophes are escaped. Hits are filtered on the full text afterwards (keepContaining).
     */
    @TestVisible
    private static String soslEscape(String t) {
        String out = '';
        for (Integer i = 0; i < t.length(); i++) {
            String ch = t.substring(i, i + 1);
            out += '?&|!{}[]()^~*:\\"+-'.contains(ch) ? ' ' : ch;
        }
        return String.escapeSingleQuotes(out.normalizeSpace());
    }

    /** Most results Link to Existing's Advanced Search shows (#160). */
    @TestVisible static final Integer LINK_SEARCH_MAX = 50;

    /**
     * #160 Link to Existing: the Lead or Contact search (the dropdown asks for 5, Advanced Search for 50). Salesforce search
     * (SOSL, user mode), then only records whose name, email, company / account or zip contains the text, or whose phone
     * contains its digits (4 or more). Leads: not converted. Most recently changed first.
     */
    @AuraEnabled
    public static List<PersonHit> searchLinkRecords(String kind, String term, Integer max) {
        Boolean isLead = kind == 'Lead';
        String t = term == null ? '' : term.trim().left(80);
        String q = soslEscape(t);
        Integer n = Math.max(1, Math.min(max == null ? 5 : max, LINK_SEARCH_MAX));
        List<PersonHit> out = new List<PersonHit>();
        if (t.length() < 2 || q.length() < 2) {
            return out;
        }
        String obj = isLead ? 'Lead' : 'Contact';
        String fields = presentPaths(obj, isLead ? PEOPLE_LEAD_FIELDS : PEOPLE_CONTACT_FIELDS);
        List<SObject> found;
        try {
            found = Search.query('FIND \'' + q + '*\' IN ALL FIELDS RETURNING ' + obj + '(' + fields
                + (isLead ? ' WHERE IsConverted = false' : '') + ' ORDER BY LastModifiedDate DESC LIMIT ' + (n * 4) + ')',
                AccessLevel.USER_MODE)[0];
        } catch (Exception e) {
            throw auraError('Salesforce search failed: ' + e.getMessage());
        }
        String lower = t.toLowerCase();
        String digits = t.replaceAll('\\D', '');
        List<String> textPaths = isLead
            ? new List<String>{ 'Name', 'Email', 'Company', 'PostalCode' }
            : new List<String>{ 'Name', 'Email', 'Account.Name', 'MailingPostalCode' };
        for (SObject s : found) {
            Boolean hit = false;
            for (String p : textPaths) {
                String v = pathText(s, p);
                hit = hit || (v != null && v.toLowerCase().contains(lower));
            }
            for (String p : new List<String>{ 'Phone', 'MobilePhone' }) {
                String v = pathText(s, p);
                hit = hit || (digits.length() >= 4 && v != null && v.replaceAll('\\D', '').contains(digits));
            }
            if (hit) {
                out.add(personHit(s, obj));
            }
            if (out.size() >= n) {
                break;
            }
        }
        return out;
    }

    /** Open Opportunities per Contact (Contact Role, IsClosed = false): count + distinct stages, newest opp first. */
    private static void addOpenOpps(Map<Id, PersonHit> byId, List<String> errors) {
        Set<Id> cids = new Set<Id>();
        for (PersonHit p : byId.values()) {
            if (p.kind == 'Contact') {
                cids.add(p.id);
            }
        }
        if (cids.isEmpty()) {
            return;
        }
        try {
            Set<String> seen = new Set<String>();
            for (OpportunityContactRole ocr : [
                SELECT ContactId, OpportunityId, Opportunity.StageName
                FROM OpportunityContactRole
                WHERE ContactId IN :cids AND Opportunity.IsClosed = false
                WITH USER_MODE
                ORDER BY Opportunity.CreatedDate DESC
                LIMIT 500
            ]) {
                if (!seen.add(String.valueOf(ocr.ContactId) + ':' + String.valueOf(ocr.OpportunityId))) {
                    continue;
                }
                PersonHit p = byId.get(ocr.ContactId);
                p.openOppCount++;
                String st = ocr.Opportunity == null ? null : ocr.Opportunity.StageName;
                if (st != null && !p.openOppStages.contains(st)) {
                    p.openOppStages.add(st);
                }
            }
        } catch (Exception e) {
            errors.add('Open opportunities: ' + e.getMessage());
        }
    }

    /** Latest submission per Lead / Contact on one object (Form_Submission__c or Website_Instant_Estimate__c). */
    private static void addSubmissionInfo(Map<Id, PersonHit> byId, String obj, String timeField, List<String> errors) {
        if (byId.isEmpty() || !hasField(obj, 'Lead__c') || !hasField(obj, 'Contact__c')) {
            return;
        }
        Set<Id> ids = byId.keySet();
        Boolean claimable = hasField(obj, 'Claimed_By__c');
        Boolean useTime = timeField != null && hasField(obj, timeField);
        try {
            for (SObject s : Database.queryWithBinds(
                    'SELECT Lead__c, Contact__c, CreatedDate' + (useTime ? ', ' + timeField : '') + (claimable ? ', Claimed_By__c' : '')
                    + ' FROM ' + obj + ' WHERE Lead__c IN :ids OR Contact__c IN :ids ORDER BY CreatedDate DESC LIMIT 1000',
                    new Map<String, Object>{ 'ids' => ids }, AccessLevel.USER_MODE)) {
                Datetime at = useTime && s.get(timeField) != null ? (Datetime) s.get(timeField) : (Datetime) s.get('CreatedDate');
                for (String f : new List<String>{ 'Lead__c', 'Contact__c' }) {
                    PersonHit p = s.get(f) == null ? null : byId.get((Id) s.get(f));
                    if (p == null) {
                        continue;
                    }
                    p.submissionCount++;
                    if (p.lastSubmissionAt == null || at > p.lastSubmissionAt) {
                        p.lastSubmissionAt = at;
                        p.lastSubmissionClaimed = claimable && s.get('Claimed_By__c') != null;
                    }
                }
            }
        } catch (Exception e) {
            errors.add(obj + ': ' + e.getMessage());
        }
    }

    private static AuraHandledException auraError(String msg) {
        AuraHandledException e = new AuraHandledException(msg);
        e.setMessage(msg);
        return e;
    }
}
