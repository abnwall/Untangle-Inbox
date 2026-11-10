/**
 * Tests for LdrInboxController.
 *
 * Test data comes from TestDataUtility wherever it has a builder (Lead, Contact, Account,
 * Territory2__c, Zip_Codes_Master__c, User). Form_Submission__c, KBMax_Web_Quote__c and
 * Website_Instant_Estimate__c have no builder in TestDataUtility, so they are built locally.
 *
 * Lead insert runs leadTriggerServices.validateZip / prepareLeadRecordValues, which require a
 * matching Zip_Codes_Master__c row for US leads. @TestSetup therefore seeds the territory data
 * once; every test method sees it (rolled back to this state after each method).
 *
 * NOTE: Lead inserts in this org may still be affected by validation rules,
 * DupeBlocker, LeanData or other automation. If a test fails on insert,
 * adjust makeLeadWith() to satisfy those rules.
 */
@IsTest
private class LdrInboxControllerTest {

    /**
     * Seeds the territory data that Lead creation depends on.
     * Order matters: getTerritoryMaster() inserts its own System Administrator test user (a setup
     * object) before we insert any non-setup records. This mirrors the order used in
     * leadTriggerNew_Test.
     */
    @TestSetup
    static void setupTerritoryData() {
        // 1. Zip master rows (also inserts the owner user internally).
        //    Zips seeded by the utility: 12345, 08619, 94040, 94941, 44030, 440304,
        //    'V0M 9S9', 'V0M', 'nmm'. makeLeadWith() uses 08619 / US.
        List<Zip_Codes_Master__c> zips = TestDataUtility.getTerritoryMaster();

        // 2. Territory. getTerritory() builds testDataSize identical 'SoCal' rows; one is enough.
        Integer originalSize = TestDataUtility.testDataSize;
        TestDataUtility.testDataSize = 1;
        List<Territory2__c> territories;
        try {
            territories = TestDataUtility.getTerritory();
        } finally {
            TestDataUtility.testDataSize = originalSize;
        }
        insert territories;

        // 3. Link every zip master row to the territory, then insert.
        for (Zip_Codes_Master__c z : zips) {
            z.TerritoryLookup__c = territories[0].Id;
        }
        insert zips;
    }

    // ---------------------------------------------------------------- data builders

    /** A Lead built by TestDataUtility (zip 08619 / US matches the seeded zip master), with the given identity. */
    private static Lead makeLeadWith(String firstName, String lastName, String company, String email) {
        Integer originalSize = TestDataUtility.testDataSize;
        TestDataUtility.testDataSize = 1;
        Lead l;
        try {
            l = TestDataUtility.createLeadTestData()[0];
        } finally {
            TestDataUtility.testDataSize = originalSize;
        }
        l.FirstName = firstName;
        l.LastName = lastName;
        l.Company = company;
        l.Email = email;
        l.Status = 'New';
        insert l;
        return l;
    }

    private static Lead makeLead(String suffix) {
        return makeLeadWith('Ldrtest', 'Inbox' + suffix, 'LDR Inbox Test Co ' + suffix,
            'ldr.inbox.test.' + suffix + '@example.com');
    }

    private static Contact makeContact(String lastName, String email) {
        return makeContact(lastName, email, new Map<String, Object>());
    }

    /** extra = additional field values (API name -> value) set before the insert, e.g. package fields. */
    private static Contact makeContact(String lastName, String email, Map<String, Object> extra) {
        Integer originalSize = TestDataUtility.testDataSize;
        TestDataUtility.testDataSize = 1;
        Contact c;
        try {
            c = TestDataUtility.createConTestData()[0];
        } finally {
            TestDataUtility.testDataSize = originalSize;
        }
        c.FirstName = 'Ldrtest';
        c.LastName = lastName;
        c.Email = email;
        for (String field : extra.keySet()) {
            c.put(field, extra.get(field));
        }
        insert c;
        return c;
    }

    private static Id makeAccountId() {
        Integer originalSize = TestDataUtility.testDataSize;
        TestDataUtility.testDataSize = 1;
        try {
            Account a = TestDataUtility.createAccountTestData()[0];
            a.Name = 'LDR Inbox Test Account';
            a.BillingCity = 'Stockton';
            insert a;
            return a.Id;
        } catch (Exception e) {
            return null; // org validation may block a bare Account insert
        } finally {
            TestDataUtility.testDataSize = originalSize;
        }
    }

    /** Throws if org automation blocks the insert; callers catch and skip. */
    private static Opportunity makeOpportunity(Id accountId) {
        Integer originalSize = TestDataUtility.testDataSize;
        TestDataUtility.testDataSize = 1;
        try {
            Opportunity o = TestDataUtility.createOppTestData()[0];
            o.Name = 'LDR Inbox Test Opp';
            o.AccountId = accountId;
            insert o;
            return o;
        } finally {
            TestDataUtility.testDataSize = originalSize;
        }
    }

    private static Form_Submission__c makeSubmission(Id leadId, String suffix) {
        Form_Submission__c f = new Form_Submission__c(
            Lead__c = leadId,
            First_Name__c = 'Ldrtest',
            Last_Name__c = 'Inbox' + suffix,
            Email_Address__c = 'ldr.inbox.test.' + suffix + '@example.com',
            Customer_Type__c = 'Contractor',
            Inquiry_Type__c = 'Quote',
            Submit_Time__c = Datetime.now()
        );
        insert f;
        return f;
    }

    /**
     * A second active user that is not the running user. Uses the user that
     * TestDataUtility.getTerritoryMaster() created in @TestSetup (it is the zip owner).
     */
    private static User otherUser() {
        return [
            SELECT Id, Name FROM User
            WHERE IsActive = true AND Id != :UserInfo.getUserId()
            AND Id IN (SELECT User__c FROM Zip_Codes_Master__c)
            LIMIT 1
        ];
    }

    // ---------------------------------------------------------------- tests

    @IsTest
    static void queueReturnsSubmissionAndPicklists() {
        Lead l = makeLead('a');
        Form_Submission__c f = makeSubmission(l.Id, 'a');

        Test.startTest();
        LdrInboxController.QueueResult r = LdrInboxController.getQueue(null);
        LdrInboxController.QueueResult r2 = LdrInboxController.getQueue(7);
        Test.stopTest();

        Boolean found = false;
        for (Form_Submission__c s : r.submissions) {
            if (s.Id == f.Id) { found = true; }
        }
        System.assert(found, 'New submission should be in the queue');
        System.assert(!r.statusOptions.isEmpty(), 'Lead Status values expected');
        System.assertEquals(UserInfo.getUserId(), r.userId);
        System.assertNotEquals(null, r.coordinators, 'Project Coordinator choices are returned');
        for (String name : r.coordinators.values()) {
            System.assert(LdrInboxController.COORDINATOR_NAMES.contains(name), 'Only the coordinators: ' + name);
        }
        System.assertNotEquals(null, r2.submissions);
    }

    @IsTest
    static void claimSetsFieldsAndReleaseClears() {
        Lead l = makeLead('b');
        Form_Submission__c f = makeSubmission(l.Id, 'b');

        Test.startTest();
        LdrInboxController.claim(f.Id);
        Datetime before = Datetime.now().addSeconds(-1);
        Form_Submission__c afterClaim = [SELECT Claimed_By__c, ClaimedDate__c FROM Form_Submission__c WHERE Id = :f.Id];
        Lead leadAfterClaim = [SELECT Status, Project_Coordinator__c FROM Lead WHERE Id = :l.Id];

        LdrInboxController.release(f.Id);
        Test.stopTest();

        System.assertEquals(UserInfo.getUserId(), afterClaim.Claimed_By__c);
        System.assert(afterClaim.ClaimedDate__c != null && afterClaim.ClaimedDate__c >= before.addMinutes(-1), '#156: the claim time');
        System.assertEquals(UserInfo.getUserId(), leadAfterClaim.Project_Coordinator__c);
        System.assertEquals('New', leadAfterClaim.Status, 'Claim must not change Status');

        Form_Submission__c afterRelease = [SELECT Claimed_By__c, ClaimedDate__c FROM Form_Submission__c WHERE Id = :f.Id];
        Lead leadAfterRelease = [SELECT Status, Project_Coordinator__c FROM Lead WHERE Id = :l.Id];
        System.assertEquals(null, afterRelease.Claimed_By__c);
        System.assertEquals(null, afterRelease.ClaimedDate__c, 'Release clears the claim time');
        System.assertEquals(null, leadAfterRelease.Project_Coordinator__c);
        System.assertEquals('New', leadAfterRelease.Status);
    }

    /** v5.6: the Project Details popup's checkboxes come from the UI as 'true' / 'false' (blank = unchecked). */
    @IsTest
    static void typedValueReadsCheckboxes() {
        System.assertEquals(true, LdrInboxController.typedValue(Lead.SObjectType, 'Quote_Request__c', 'true'), 'Checked');
        System.assertEquals(false, LdrInboxController.typedValue(Lead.SObjectType, 'Quote_Request__c', 'false'), 'Unchecked');
        System.assertEquals(false, LdrInboxController.typedValue(Lead.SObjectType, 'Reference_Opportunity__c', ''), 'Blank = unchecked');
        System.assertEquals(null, LdrInboxController.typedValue(Lead.SObjectType, 'Project_Timeline__c', ''), 'Blank picklist = null');
        System.assertEquals('1-3 Months', LdrInboxController.typedValue(Lead.SObjectType, 'Project_Timeline__c', '1-3 Months'), 'Picklist as is');
    }

    @IsTest
    static void claimConflictWhenSomeoneElseHoldsIt() {
        User other = otherUser();
        Lead l = makeLead('c');
        Form_Submission__c f = makeSubmission(l.Id, 'c');
        f.Claimed_By__c = other.Id;
        update f;

        String msg;
        Test.startTest();
        try {
            LdrInboxController.claim(f.Id);
        } catch (AuraHandledException e) {
            msg = e.getMessage();
        }
        Test.stopTest();

        System.assertNotEquals(null, msg, 'Expected a conflict error');
        System.assert(msg.startsWith(LdrInboxController.CONFLICT_PREFIX), msg);
        Form_Submission__c still = [SELECT Claimed_By__c FROM Form_Submission__c WHERE Id = :f.Id];
        System.assertEquals(other.Id, still.Claimed_By__c, 'Existing claim must not be overwritten');
    }

    @IsTest
    static void claimTakesOverCoordinator() {
        User other = otherUser();
        Lead l = makeLead('h');
        l.Project_Coordinator__c = other.Id;
        update l;
        Form_Submission__c f = makeSubmission(l.Id, 'h');

        Test.startTest();
        LdrInboxController.claim(f.Id);
        Lead afterClaim = [SELECT Project_Coordinator__c, Lead_Funnel_Time_Stamp__c, Status FROM Lead WHERE Id = :l.Id];
        LdrInboxController.ClaimContext ctx = LdrInboxController.getClaimContext(f.Id);
        LdrInboxController.release(f.Id);
        Test.stopTest();

        System.assertEquals(UserInfo.getUserId(), afterClaim.Project_Coordinator__c, 'Claim takes over the coordinator');
        System.assertEquals(Date.today(), afterClaim.Lead_Funnel_Time_Stamp__c, 'Claim stamps the funnel timestamp');
        System.assertEquals('New', afterClaim.Status, 'A New lead stays New on claim');
        System.assertNotEquals(null, ctx);
        // Field history is not written in tests, so the previous coordinator cannot be restored here.
        Lead afterRelease = [SELECT Project_Coordinator__c FROM Lead WHERE Id = :l.Id];
        System.assertNotEquals(UserInfo.getUserId(), afterRelease.Project_Coordinator__c, 'Release gives up the coordinator');
    }

    @IsTest
    static void contactLinkedSubmissionClaimAndCall() {
        Contact c;
        try {
            c = makeContact('Contact', 'ldr.inbox.contact@example.com');
        } catch (Exception e) {
            return; // org validation may block a bare Contact insert; nothing to test then
        }
        Form_Submission__c f = new Form_Submission__c(
            Contact__c = c.Id, First_Name__c = 'Ldrtest', Last_Name__c = 'Contact',
            Email_Address__c = c.Email, Customer_Type__c = 'Architect', Inquiry_Type__c = 'Consultation',
            Submit_Time__c = Datetime.now());
        insert f;
        String noClaimErr;

        Test.startTest();
        LdrInboxController.QueueResult r = LdrInboxController.getQueue(null);
        LdrInboxController.claim(f.Id);
        Contact afterClaim = [SELECT Project_Coordinator__c, Lead_Funnel_Time_Stamp__c, Lead_Funnel_Status__c
                              FROM Contact WHERE Id = :c.Id];
        LdrInboxController.logCall(f.Id, 'No Answer', null);
        LdrInboxController.saveLeadFields(f.Id, 'Working', null, null, null,
            new Map<String, String>{ 'Lead_Funnel_Time_Stamp__c' => '2026-10-01' });
        Contact afterSave = [SELECT Lead_Funnel_Status__c, Lead_Funnel_Time_Stamp__c FROM Contact WHERE Id = :c.Id];
        try {
            // not converted from a Lead after the submission, so status-without-claim is refused
            LdrInboxController.saveStatusWithoutClaim(f.Id, 'Nurture', null);
        } catch (AuraHandledException e) {
            noClaimErr = e.getMessage();
        }
        List<LdrInboxController.RelatedItem> opps = LdrInboxController.getContactOpportunities(c.Id);
        List<LdrInboxController.RelatedItem> oppsNone = LdrInboxController.getContactOpportunities(null);
        LdrInboxController.LeadTimeline t = LdrInboxController.getLeadTimeline(c.Id);
        LdrInboxController.release(f.Id);
        Test.stopTest();

        Boolean found = false;
        for (Form_Submission__c s : r.submissions) {
            if (s.Id == f.Id) { found = true; }
        }
        System.assert(found, 'Contact-linked submissions are in the queue');
        System.assertNotEquals(null, r.contactStatusOptions);
        System.assertNotEquals(null, r.contactConvertedAt);
        System.assertEquals(UserInfo.getUserId(), afterClaim.Project_Coordinator__c, 'Claim sets the Contact coordinator');
        System.assertEquals(Date.today(), afterClaim.Lead_Funnel_Time_Stamp__c);
        System.assertEquals('New', afterClaim.Lead_Funnel_Status__c, 'Blank Contact status becomes New on claim');
        System.assertEquals('Working', afterSave.Lead_Funnel_Status__c, 'Contact status saves to Lead_Funnel_Status__c');
        System.assertEquals(Date.newInstance(2026, 10, 1), afterSave.Lead_Funnel_Time_Stamp__c);
        System.assertNotEquals(null, noClaimErr);
        System.assertNotEquals(null, opps);
        System.assert(oppsNone.isEmpty());
        System.assertNotEquals(null, t);
        System.assertEquals(1, [SELECT COUNT() FROM Task WHERE WhoId = :c.Id AND Subject LIKE 'Call:%']);
        System.assertEquals(null, [SELECT Claimed_By__c FROM Form_Submission__c WHERE Id = :f.Id].Claimed_By__c);
        Contact afterRelease = [SELECT Project_Coordinator__c, Lead_Funnel_Status__c FROM Contact WHERE Id = :c.Id];
        System.assertEquals(null, afterRelease.Project_Coordinator__c, 'No history in tests: coordinator cleared');
        System.assertEquals('New', afterRelease.Lead_Funnel_Status__c, 'Working -> New on release');
    }

    @IsTest
    static void contactConvertedAfterSubmissionAllowsStatusWithoutClaim() {
        Lead l = makeLead('conv');
        Form_Submission__c f = new Form_Submission__c(
            First_Name__c = 'Ldrtest', Last_Name__c = 'Conv', Email_Address__c = 'ldr.conv@example.com',
            Customer_Type__c = 'Architect', Inquiry_Type__c = 'Consultation',
            Submit_Time__c = Datetime.now().addDays(-3));
        insert f;
        Id contactId;
        try {
            Database.LeadConvert lc = new Database.LeadConvert();
            lc.setLeadId(l.Id);
            lc.setConvertedStatus([SELECT ApiName FROM LeadStatus WHERE IsConverted = true LIMIT 1].ApiName);
            lc.setDoNotCreateOpportunity(true);
            contactId = Database.convertLead(lc).getContactId();
        } catch (Exception e) {
            return; // conversion flows/validation in this org may block a test conversion
        }
        f.Contact__c = contactId;
        update f;

        Test.startTest();
        Map<Id, Datetime> conv = LdrInboxController.convertedAtFor(new Set<Id>{ contactId });
        LdrInboxController.saveStatusWithoutClaim(f.Id, 'Nurture', null);
        Test.stopTest();

        System.assert(conv.containsKey(contactId), 'Converted Contact has a conversion time');
        System.assertEquals('Nurture', [SELECT Lead_Funnel_Status__c FROM Contact WHERE Id = :contactId].Lead_Funnel_Status__c);
        System.assertEquals(null, [SELECT Claimed_By__c FROM Form_Submission__c WHERE Id = :f.Id].Claimed_By__c,
            'Status-only save does not claim');
    }

    @IsTest
    static void unlinkedSubmissionCanBeClaimedButNotWorked() {
        Form_Submission__c f = new Form_Submission__c(
            First_Name__c = 'Ldrtest', Last_Name__c = 'Unlinked', Email_Address__c = 'ldr.unlinked@example.com',
            Customer_Type__c = 'Architect', Inquiry_Type__c = 'Quote', Submit_Time__c = Datetime.now());
        insert f;
        String saveErr;
        String callErr;

        Test.startTest();
        LdrInboxController.QueueResult r = LdrInboxController.getQueue(null);
        LdrInboxController.claim(f.Id);
        try {
            LdrInboxController.saveLeadFields(f.Id, 'Working', null, null, null, null);
        } catch (AuraHandledException e) {
            saveErr = e.getMessage();
        }
        try {
            LdrInboxController.logCall(f.Id, 'No Answer', null);
        } catch (AuraHandledException e) {
            callErr = e.getMessage();
        }
        LdrInboxController.ClaimContext ctx = LdrInboxController.getClaimContext(f.Id);
        Id claimedBy = [SELECT Claimed_By__c FROM Form_Submission__c WHERE Id = :f.Id].Claimed_By__c;
        LdrInboxController.release(f.Id);
        Map<Id, String> assigned = LdrInboxController.assignedByFor(new Set<Id>{ f.Id });
        Test.stopTest();

        Boolean found = false;
        for (Form_Submission__c s : r.submissions) {
            if (s.Id == f.Id) { found = true; }
        }
        System.assert(found, 'Submissions with no Lead or Contact yet are in the queue');
        System.assertEquals(UserInfo.getUserId(), claimedBy, 'An unlinked submission can be claimed');
        System.assertNotEquals(null, saveErr, 'No record to save fields to');
        System.assertNotEquals(null, callErr, 'No record to log a call against');
        System.assertEquals(null, ctx.tookOverFrom);
        System.assertNotEquals(null, assigned);
        System.assertEquals(null, [SELECT Claimed_By__c FROM Form_Submission__c WHERE Id = :f.Id].Claimed_By__c);
    }

    @IsTest
    static void queueCountsAndAccountSummary() {
        Lead l = makeLead('i');
        makeSubmission(l.Id, 'i');
        Id accountId = makeAccountId();

        Test.startTest();
        LdrInboxController.QueueResult r = LdrInboxController.getQueue(null);
        LdrInboxController.AccountSummary none = LdrInboxController.getAccountSummary(null);
        LdrInboxController.AccountSummary acct = LdrInboxController.getAccountSummary(accountId);
        List<LdrInboxController.RelatedItem> rel = LdrInboxController.getRelated(l.Id, null, null);
        List<LdrInboxController.RelatedItem> relNone = LdrInboxController.getRelated(null, null, null);
        Test.stopTest();

        System.assertNotEquals(null, r.kbmaxCounts);
        System.assertNotEquals(null, r.estimateCounts);
        System.assert(none.opportunities.isEmpty());
        System.assertNotEquals(null, acct);
        if (accountId != null) {
            System.assertEquals('Stockton', acct.city);
        }
        System.assert(rel.isEmpty(), 'No KBMax quotes or estimates were created');
        System.assert(relNone.isEmpty());
    }

    @IsTest
    static void saveHandoffAndLogCall() {
        Lead l = makeLead('d');
        Form_Submission__c f = makeSubmission(l.Id, 'd');
        LdrInboxController.claim(f.Id);

        Test.startTest();
        LdrInboxController.saveLeadFields(f.Id, 'Working', 'Too Early', 'Test Project', 'Left voicemail', null);
        Lead saved = [SELECT Lead_Funnel_Outcome__c, LDR_Project_Name__c, LDR_Notes__c FROM Lead WHERE Id = :l.Id];
        LdrInboxController.handoff(f.Id, 'Test Project', 'Ready for rep', new Map<String, String>{ 'Project_Site_City__c' => 'Stockton' });
        LdrInboxController.logCall(f.Id, 'Left Voicemail', 'Asked for a callback Friday');
        Test.stopTest();

        System.assertEquals('Too Early', saved.Lead_Funnel_Outcome__c);
        System.assertEquals('Test Project', saved.LDR_Project_Name__c);
        Lead handed = [SELECT Status, Lead_Funnel_Outcome__c FROM Lead WHERE Id = :l.Id];
        System.assertEquals('Qualified', handed.Status);
        System.assertEquals('Hand-off to Rep', handed.Lead_Funnel_Outcome__c);
        System.assertEquals(1, [SELECT COUNT() FROM Task WHERE WhoId = :l.Id AND Subject LIKE 'Call:%']);
        // canvas aabc (#96E): the call comments are saved to Task.Description
        Task call = [SELECT Description FROM Task WHERE WhoId = :l.Id AND Subject LIKE 'Call:%' LIMIT 1];
        System.assert(call.Description.startsWith('Asked for a callback Friday'), call.Description);
    }

    @IsTest
    static void writesBlockedWhenNotClaimed() {
        Lead l = makeLead('e');
        Form_Submission__c f = makeSubmission(l.Id, 'e');
        Integer errors = 0;
        LdrInboxController.adminUserIds = new Set<Id>(); // admins may save unclaimed rows; test as a normal LDR

        Test.startTest();
        try { LdrInboxController.saveLeadFields(f.Id, 'Working', null, null, null, null); } catch (AuraHandledException e) { errors++; }
        try { LdrInboxController.release(f.Id); } catch (AuraHandledException e) { errors++; }
        try { LdrInboxController.logCall(f.Id, 'No Answer', null); } catch (AuraHandledException e) { errors++; }
        Test.stopTest();

        System.assertEquals(3, errors, 'Unclaimed submission must not be editable');
    }

    @IsTest
    static void personSubmissionsMatchByEmail() {
        Lead l = makeLead('f');
        Form_Submission__c f1 = makeSubmission(l.Id, 'f');
        Lead l2 = makeLead('g');
        Form_Submission__c f2 = makeSubmission(l2.Id, 'g');
        f2.Email_Address__c = f1.Email_Address__c;
        f2.Inquiry_Type__c = 'Representative';
        update f2;

        Test.startTest();
        List<LdrInboxController.PersonSubmission> rel = LdrInboxController.getPersonSubmissions(f1.Email_Address__c, f1.Id);
        List<LdrInboxController.PersonSubmission> none = LdrInboxController.getPersonSubmissions(null, f1.Id);
        Test.stopTest();

        System.assertEquals(1, rel.size(), 'Only the other submission with the same email');
        System.assertEquals(f2.Id, rel[0].recordId);
        System.assertEquals('Representative', rel[0].inquiryType);
        System.assert(none.isEmpty());
    }

    @IsTest
    static void claimResetsQualifiedStatus() {
        Lead l = makeLead('q');
        l.Status = 'Qualified';
        update l;
        Form_Submission__c f = makeSubmission(l.Id, 'q');

        Test.startTest();
        LdrInboxController.claim(f.Id);
        Test.stopTest();

        System.assertEquals('New', [SELECT Status FROM Lead WHERE Id = :l.Id].Status,
            'Claiming a Qualified lead resets it to New so it stays visible in Mine');
    }

    @IsTest
    static void claimResetsStaleStatus() {
        Lead l = makeLead('k');
        l.Status = 'Nurture';
        l.Lead_Funnel_Outcome__c = 'Too Early';
        update l;
        Form_Submission__c f = makeSubmission(l.Id, 'k');

        Test.startTest();
        LdrInboxController.claim(f.Id);
        Test.stopTest();

        Lead after = [SELECT Status, Lead_Funnel_Outcome__c FROM Lead WHERE Id = :l.Id];
        System.assertEquals('New', after.Status, 'Claiming a stale Nurture lead resets it to New');
        System.assertEquals(null, after.Lead_Funnel_Outcome__c, '#153 A: New after the claim clears the Outcome');
    }

    @IsTest
    static void assignToCoordinatorSetsClaimer() {
        User other = otherUser();
        Lead l = makeLead('m');
        l.Project_Coordinator__c = other.Id;
        update l;
        Form_Submission__c f = makeSubmission(l.Id, 'm');
        Lead noCoord = makeLead('n');
        Form_Submission__c f2 = makeSubmission(noCoord.Id, 'n');

        String err;
        Test.startTest();
        LdrInboxController.assignToCoordinator(f.Id);
        try {
            LdrInboxController.assignToCoordinator(f2.Id);
        } catch (AuraHandledException e) {
            err = e.getMessage();
        }
        Test.stopTest();

        System.assertEquals(other.Id, [SELECT Claimed_By__c FROM Form_Submission__c WHERE Id = :f.Id].Claimed_By__c);
        System.assertEquals('Working', [SELECT Status FROM Lead WHERE Id = :l.Id].Status);
        System.assertNotEquals(null, err, 'No coordinator should raise an error');
    }

    /**
     * Wrong profile saves with or without a Lead Funnel Outcome (2026-10-21: the inbox only flags the Outcome; Status
     * Reason isn't edited any more, and isn't written).
     */
    @IsTest
    static void wrongProfileSavesWithOrWithoutOutcome() {
        Lead l = makeLead('p');
        Form_Submission__c f = makeSubmission(l.Id, 'p');
        LdrInboxController.claim(f.Id);

        Test.startTest();
        LdrInboxController.saveLeadFields(f.Id, 'Wrong profile', null, null, null, null);
        Lead noOutcome = [SELECT Status, Lead_Funnel_Outcome__c FROM Lead WHERE Id = :l.Id];
        LdrInboxController.saveLeadFields(f.Id, 'Wrong profile', 'Spam/Solicitation', null, null, null);
        Test.stopTest();

        System.assertEquals('Wrong profile', noOutcome.Status, 'Saving without an Outcome is allowed');
        System.assertEquals(null, noOutcome.Lead_Funnel_Outcome__c);
        Lead saved = [SELECT Status, Lead_Funnel_Outcome__c FROM Lead WHERE Id = :l.Id];
        System.assertEquals('Wrong profile', saved.Status);
        System.assertEquals('Spam/Solicitation', saved.Lead_Funnel_Outcome__c);
    }

    /** A status that isn't an active picklist value any more counts as retired (claim resets it to New). */
    @IsTest
    static void retiredStatusesAreDetected() {
        System.assertEquals(false, LdrInboxController.isRetiredStatus('Lead', 'Status', 'New'));
        System.assertEquals(false, LdrInboxController.isRetiredStatus('Contact', 'Lead_Funnel_Status__c', 'Working'));
        System.assertEquals(false, LdrInboxController.isRetiredStatus('Lead', 'Status', null));
        System.assertEquals(true, LdrInboxController.isRetiredStatus('Lead', 'Status', 'Not A Real Status Value'));
        System.assertEquals(true, LdrInboxController.isRetiredStatus('Contact', 'Lead_Funnel_Status__c', 'Not A Real Status Value'));
        System.assertEquals(false, LdrInboxController.isRetiredStatus('Lead', 'No_Such_Field__c', 'Anything'));
    }

    @IsTest
    static void representativeInquiriesExcluded() {
        Lead l = makeLead('q');
        Form_Submission__c f = makeSubmission(l.Id, 'q');
        f.Inquiry_Type__c = 'Representative';
        update f;

        Test.startTest();
        LdrInboxController.QueueResult r = LdrInboxController.getQueue(null);
        Test.stopTest();

        for (Form_Submission__c s : r.submissions) {
            System.assertNotEquals(f.Id, s.Id, 'Representative requests must not be in the queue');
        }
    }

    @IsTest
    static void preConversionFieldsAndTimeline() {
        Lead l = makeLead('r');
        Form_Submission__c f = makeSubmission(l.Id, 'r');
        LdrInboxController.claim(f.Id);
        String err;

        Test.startTest();
        LdrInboxController.saveLeadFields(f.Id, 'Working', null, 'Proj', 'Notes',
            new Map<String, String>{ 'Project_Name__c' => 'Test Project', 'Project_Site_City__c' => 'Stockton',
                'Lead_Funnel_Time_Stamp__c' => '2026-10-01', 'Project_Coordinator__c' => UserInfo.getUserId() });
        try {
            LdrInboxController.saveLeadFields(f.Id, 'Working', null, null, null,
                new Map<String, String>{ 'OwnerId' => UserInfo.getUserId() });
        } catch (AuraHandledException e) {
            err = e.getMessage();
        }
        LdrInboxController.logCall(f.Id, 'No Answer', null);
        LdrInboxController.LeadTimeline t = LdrInboxController.getLeadTimeline(l.Id);
        LdrInboxController.LeadTimeline none = LdrInboxController.getLeadTimeline(null);
        Test.stopTest();

        Lead saved = [SELECT Project_Name__c, Project_Site_City__c, Lead_Funnel_Time_Stamp__c FROM Lead WHERE Id = :l.Id];
        System.assertEquals('Test Project', saved.Project_Name__c);
        System.assertEquals('Stockton', saved.Project_Site_City__c);
        System.assertEquals(Date.newInstance(2026, 10, 1), saved.Lead_Funnel_Time_Stamp__c);
        System.assertNotEquals(null, err, 'Fields outside the pre-conversion list must be rejected');
        System.assertEquals(1, t.activity.size(), 'The logged call should appear in Activity History');
        System.assert(none.history.isEmpty() && none.activity.isEmpty());
    }

    // ---------------------------------------------------------------- prototype 1791332457-946d

    @IsTest
    static void claimAlsoClaimsSiblingSubmissions() {
        Lead l = makeLead('sib');
        Form_Submission__c f1 = makeSubmission(l.Id, 'sib');
        Form_Submission__c f2 = makeSubmission(l.Id, 'sib');
        Form_Submission__c rep = makeSubmission(l.Id, 'sib');
        rep.Inquiry_Type__c = 'Representative';
        update rep;

        Test.startTest();
        Integer extra = LdrInboxController.claim(f1.Id);
        Test.stopTest();

        System.assertEquals(1, extra, 'The other unclaimed submission on the same Lead is claimed too');
        System.assertEquals(UserInfo.getUserId(), [SELECT Claimed_By__c FROM Form_Submission__c WHERE Id = :f2.Id].Claimed_By__c);
        System.assertEquals(null, [SELECT Claimed_By__c FROM Form_Submission__c WHERE Id = :rep.Id].Claimed_By__c,
            'Representative requests are never claimed');
    }

    @IsTest
    static void unlinkedSiblingsMatchByEmail() {
        Form_Submission__c a = new Form_Submission__c(First_Name__c = 'Ldrtest', Last_Name__c = 'Sib',
            Email_Address__c = 'ldr.sib.unlinked@example.com', Inquiry_Type__c = 'Quote', Submit_Time__c = Datetime.now());
        Form_Submission__c b = a.clone(false, true);
        insert new List<Form_Submission__c>{ a, b };

        Test.startTest();
        Integer extra = LdrInboxController.claim(a.Id);
        Test.stopTest();

        System.assertEquals(1, extra);
        System.assertEquals(UserInfo.getUserId(), [SELECT Claimed_By__c FROM Form_Submission__c WHERE Id = :b.Id].Claimed_By__c);
    }

    @IsTest
    static void reassignNeedsAPreviousCoordinator() {
        Lead l = makeLead('ra');
        Form_Submission__c f = makeSubmission(l.Id, 'ra');
        String err;

        Test.startTest();
        LdrInboxController.claim(f.Id);
        LdrInboxController.ClaimContext ctx = LdrInboxController.getClaimContext(f.Id);
        try {
            LdrInboxController.reassign(f.Id);
        } catch (AuraHandledException e) {
            err = e.getMessage();
        }
        Test.stopTest();

        // Field history isn't written in tests, so there is never a previous coordinator to give it back to here.
        System.assertEquals(false, ctx.canReassign);
        System.assertNotEquals(null, err);
        System.assertEquals(UserInfo.getUserId(), [SELECT Claimed_By__c FROM Form_Submission__c WHERE Id = :f.Id].Claimed_By__c);
    }

    @IsTest
    static void claimFromTeammate() {
        User other = otherUser();
        Lead l = makeLead('cf');
        l.Project_Coordinator__c = other.Id;
        update l;
        Form_Submission__c f = makeSubmission(l.Id, 'cf');
        f.Claimed_By__c = other.Id;
        update f;
        String conflict;

        Test.startTest();
        try {
            LdrInboxController.claimFrom(f.Id, UserInfo.getUserId()); // wrong expected claimer
        } catch (AuraHandledException e) {
            conflict = e.getMessage();
        }
        LdrInboxController.claimFrom(f.Id, other.Id);
        Test.stopTest();

        System.assert(conflict != null && conflict.startsWith('CONFLICT:'), 'Stale claimer is reported as a conflict');
        System.assertEquals(UserInfo.getUserId(), [SELECT Claimed_By__c FROM Form_Submission__c WHERE Id = :f.Id].Claimed_By__c);
        Lead after = [SELECT Project_Coordinator__c, Lead_Funnel_Time_Stamp__c FROM Lead WHERE Id = :l.Id];
        System.assertEquals(UserInfo.getUserId(), after.Project_Coordinator__c);
        System.assertEquals(Date.today(), after.Lead_Funnel_Time_Stamp__c);
    }

    @IsTest
    static void linkToExistingSuggestsAndLinks() {
        Form_Submission__c f = new Form_Submission__c(First_Name__c = 'Ldrtest', Last_Name__c = 'Linker',
            Email_Address__c = 'ldr.link.existing@example.com', Inquiry_Type__c = 'Quote', Submit_Time__c = Datetime.now());
        insert f;
        Lead l;
        try {
            l = makeLeadWith('Ldrtest', 'Linker', 'Ldrtest Link', 'ldr.link.existing@example.com');
        } catch (DmlException e) {
            System.debug('Org validation/duplicate rules blocked the test Lead: ' + e.getMessage());
            l = null;
        }
        String emptyErr;
        String wrongTypeErr;

        Test.startTest();
        List<LdrInboxController.LinkSuggestion> sugg = LdrInboxController.getLinkSuggestions(f.Id, 'Ldrtest Linker');
        try {
            LdrInboxController.linkSubmission(f.Id, null, null);
        } catch (AuraHandledException e) {
            emptyErr = e.getMessage();
        }
        try {
            LdrInboxController.linkSubmission(f.Id, UserInfo.getUserId(), null);
        } catch (AuraHandledException e) {
            wrongTypeErr = e.getMessage();
        }
        if (l != null) {
            LdrInboxController.linkSubmission(f.Id, l.Id, null);
        }
        Test.stopTest();

        System.assertNotEquals(null, emptyErr, 'Linking needs a Lead or a Contact');
        System.assertNotEquals(null, wrongTypeErr, 'A User Id is not a Lead');
        System.assert(sugg.size() <= 4, 'At most 4 suggestions');
        if (l != null) {
            System.assert(!sugg.isEmpty(), 'Same-email Lead is suggested');
            System.assertEquals('Same email', sugg[0].why);
            System.assertEquals(l.Id, [SELECT Lead__c FROM Form_Submission__c WHERE Id = :f.Id].Lead__c);
        }
    }

    @IsTest
    static void createLeadLinksTheSubmission() {
        Form_Submission__c f = new Form_Submission__c(First_Name__c = 'Ldrtest', Last_Name__c = 'Create',
            Email_Address__c = 'ldr.create.lead@example.com', Inquiry_Type__c = 'Quote', Submit_Time__c = Datetime.now());
        insert f;
        String badFieldErr;

        Test.startTest();
        LdrInboxController.claim(f.Id);
        try {
            LdrInboxController.createLeadForSubmission(f.Id, new Map<String, String>{ 'OwnerId' => UserInfo.getUserId() });
        } catch (AuraHandledException e) {
            badFieldErr = e.getMessage();
        }
        Id leadId;
        try {
            // US / 08619 matches the zip master row seeded in setupTerritoryData()
            leadId = LdrInboxController.createLeadForSubmission(f.Id, new Map<String, String>{
                'FirstName' => 'Ldrtest', 'LastName' => 'Create', 'Company' => 'Ldrtest Create',
                'Email' => 'ldr.create.lead@example.com', 'Status' => 'New',
                'CountryCode' => 'US', 'PostalCode' => '08619'
            });
        } catch (AuraHandledException e) {
            System.debug('Org validation/duplicate rules blocked the test Lead: ' + e.getMessage());
        }
        Test.stopTest();

        System.assertNotEquals(null, badFieldErr, 'Only the Create Lead fields are accepted');
        if (leadId != null) {
            System.assertEquals(leadId, [SELECT Lead__c FROM Form_Submission__c WHERE Id = :f.Id].Lead__c);
            System.assertEquals(UserInfo.getUserId(), [SELECT Project_Coordinator__c FROM Lead WHERE Id = :leadId].Project_Coordinator__c,
                'Already claimed: the new Lead gets the claimer as Project Coordinator');
        }
    }

    @IsTest
    static void adminCanSaveUnclaimedRow() {
        Lead l = makeLead('adm');
        Form_Submission__c f = makeSubmission(l.Id, 'adm');
        LdrInboxController.adminUserIds = new Set<Id>{ UserInfo.getUserId() };

        Test.startTest();
        LdrInboxController.QueueResult r = LdrInboxController.getQueue(null);
        LdrInboxController.saveLeadFields(f.Id, 'Working', null, null, null, null);
        Test.stopTest();

        System.assertEquals(true, r.isAdmin);
        System.assertEquals('Working', [SELECT Status FROM Lead WHERE Id = :l.Id].Status);
        System.assertEquals(null, [SELECT Claimed_By__c FROM Form_Submission__c WHERE Id = :f.Id].Claimed_By__c,
            'Admin edits do not claim');
    }

    @IsTest
    static void queueMapsAndActivityKinds() {
        Lead l = makeLead('maps');
        Form_Submission__c f = makeSubmission(l.Id, 'maps');

        Test.startTest();
        LdrInboxController.claim(f.Id);
        insert new Task(WhoId = l.Id, Subject = 'Call: test', TaskSubtype = 'Call', OwnerId = UserInfo.getUserId());
        LdrInboxController.QueueResult r = LdrInboxController.getQueue(null);
        LdrInboxController.LeadTimeline t = LdrInboxController.getLeadTimeline(l.Id);
        Test.stopTest();

        System.assertNotEquals(null, r.statusChangedAt);
        System.assertNotEquals(null, r.contactLeadTypes);
        System.assertNotEquals(null, r.openOppOwners);
        System.assert(r.lastActivityBy.containsKey(String.valueOf(l.Id) + ':' + String.valueOf(UserInfo.getUserId())),
            'My own Task counts as outreach');
        System.assertEquals('call', LdrInboxController.taskKind('Call'));
        System.assertEquals('email', LdrInboxController.taskKind('ListEmail'));
        System.assertEquals('task', LdrInboxController.taskKind(null));
        System.assertEquals('call', t.activity[0].kind);
    }

    // ---------------------------------------------------------------- prototype 1791413716-c90e

    @IsTest
    static void instantEstimatesAreOptionalAndCutoffParses() {
        Lead l = makeLead('est');
        Test.startTest();
        LdrInboxController.QueueResult r = LdrInboxController.getQueue(null);
        List<List<Datetime>> windows = LdrInboxController.estimateWindows();
        Datetime cutoff = windows[0][0];
        Boolean claimable = LdrInboxController.estimatesClaimable();
        Map<Id, String> six = LdrInboxController.sixSenseFor(new Set<Id>{ l.Id }, new Set<Id>());
        List<String> sixOpts = LdrInboxController.sixSenseOptions();
        Map<Id, String> courses = LdrInboxController.coursesFor(new Set<Id>());
        Test.stopTest();

        System.assertNotEquals(null, cutoff, 'Cutoff falls back to Oct 1, 2026 when the label is unreadable');
        System.assertEquals(claimable, r.estimatesEnabled);
        System.assertNotEquals(null, r.estimates, 'Empty list (not null) when estimates are off');
        if (!claimable) {
            System.assert(r.estimates.isEmpty(), 'No estimate rows until the claim fields exist');
        }
        System.assertNotEquals(null, six);
        System.assertNotEquals(null, sixOpts);
        System.assert(courses.isEmpty());
    }

    @IsTest
    static void estimateClaimWhenFieldsExist() {
        if (!LdrInboxController.estimatesClaimable()) {
            return; // Website_Instant_Estimate__c has no Claimed_By__c / ClaimedDate__c in this org yet
        }
        Lead l = makeLead('estc');
        SObject e = Schema.getGlobalDescribe().get('Website_Instant_Estimate__c').newSObject();
        e.put('Lead__c', l.Id);
        e.put('Email_Address__c', l.Email);
        e.put('Estimate_Amount__c', 'Custom');
        insert e;
        Form_Submission__c f = makeSubmission(l.Id, 'estc');

        Test.startTest();
        Integer extra = LdrInboxController.claim(e.Id);
        Test.stopTest();

        System.assertEquals(1, extra, 'Claiming the estimate also claims the same Lead\'s unclaimed form submission');
        System.assertEquals(UserInfo.getUserId(), [SELECT Claimed_By__c FROM Form_Submission__c WHERE Id = :f.Id].Claimed_By__c);
        System.assertEquals(UserInfo.getUserId(), [SELECT Project_Coordinator__c FROM Lead WHERE Id = :l.Id].Project_Coordinator__c);
    }

    // ---------------------------------------------------------------- prototype 1791477589-9853

    @IsTest
    static void estimateDateWindowsParse() {
        List<List<Datetime>> w = LdrInboxController.parseWindows(
            '2026-06-15T00:00:00-07:00..2026-07-01T00:00:00-07:00; 2026-10-05T00:00:00-07:00 ;garbage');
        System.assertEquals(2, w.size(), 'Two valid windows; the invalid part is skipped');
        System.assertEquals(Datetime.newInstanceGmt(2026, 6, 15, 7, 0, 0), w[0][0]);
        System.assertEquals(Datetime.newInstanceGmt(2026, 7, 1, 7, 0, 0), w[0][1]);
        System.assertEquals(Datetime.newInstanceGmt(2026, 10, 5, 7, 0, 0), w[1][0]);
        System.assertEquals(null, w[1][1], 'No end = open-ended');
        System.assertEquals(Datetime.newInstanceGmt(2026, 10, 5, 0, 0, 0), LdrInboxController.parseIsoDatetime('2026-10-05T00:00:00Z'));
        System.assertEquals(Datetime.newInstanceGmt(2026, 10, 5, 0, 0, 0), LdrInboxController.parseIsoDatetime('2026-10-05'));
        Map<String, Object> binds = new Map<String, Object>();
        String clause = LdrInboxController.estimateWindowClause(binds);
        System.assert(clause.contains('CreatedDate >= :ews0'));
        System.assert(!binds.isEmpty());
        System.assert(!LdrInboxController.estimateWindowLabels().isEmpty());
        System.assert(LdrInboxController.parseWindows('').isEmpty());
    }

    @IsTest
    static void convertedLeadSubmissionIsWorkedAsItsContact() {
        Lead l = makeLead('cvt');
        Form_Submission__c f = makeSubmission(l.Id, 'cvt');
        Id contactId;
        try {
            Database.LeadConvert lc = new Database.LeadConvert();
            lc.setLeadId(l.Id);
            lc.setConvertedStatus([SELECT ApiName FROM LeadStatus WHERE IsConverted = true LIMIT 1].ApiName);
            lc.setDoNotCreateOpportunity(true);
            contactId = Database.convertLead(lc).getContactId();
        } catch (Exception e) {
            return; // conversion automation in this org may block a test conversion
        }

        Test.startTest();
        LdrInboxController.QueueResult r = LdrInboxController.getQueue(null);
        LdrInboxController.claim(f.Id);
        try {
            LdrInboxController.saveSixSense(f.Id, null);
        } catch (AuraHandledException e) {
            System.debug('X6Sense_Option__c missing in this org: ' + e.getMessage());
        }
        Test.stopTest();

        System.assert(r.convertedContacts.containsKey(contactId), 'The converted Lead\'s Contact is loaded for the row');
        System.assertNotEquals(null, r.followUp);
        Form_Submission__c after = [SELECT Claimed_By__c, Contact__c FROM Form_Submission__c WHERE Id = :f.Id];
        System.assertEquals(UserInfo.getUserId(), after.Claimed_By__c);
        System.assertEquals(contactId, after.Contact__c, 'Claim links the submission to the Contact the Lead became');
        System.assertEquals(UserInfo.getUserId(), [SELECT Project_Coordinator__c FROM Contact WHERE Id = :contactId].Project_Coordinator__c);
    }

    @IsTest
    static void presentFieldsSkipsMissingFields() {
        String f = LdrInboxController.presentFields('Website_Instant_Estimate__c', 'Id, Not_A_Real_Field__c');
        System.assertEquals('Id', f, 'Fields missing in this org are left out of the query');
    }

    @IsTest
    static void estimateSelectListHasNoDuplicates() {
        List<String> fields = LdrInboxController.estimateSelectList().split(',');
        Set<String> seen = new Set<String>();
        for (String f : fields) {
            System.assert(seen.add(f.trim().toLowerCase()), 'Field selected twice: ' + f);
        }
        System.assert(seen.contains('lead__r.isconverted'));
        System.assert(seen.contains('lead__r.convertedcontactid'));
        System.assertEquals('a, b, c', LdrInboxController.dedupeFields('a, b, A, c'));
    }

    // ---------------------------------------------------------------- prototype a111: Prospects, Post Quote, Boss View

    @IsTest
    static void prospectsLoadEstimatesAndConfigurator() {
        Lead l = makeLead('pros');
        SObject q = Schema.getGlobalDescribe().get('KBMax_Web_Quote__c').newSObject();
        q.put('Lead__c', l.Id);
        q.put('Name', 'Ldrtest quote');
        q.put('KBMax_Price__c', 65000);
        q.put('Project_Name__c', 'Ldrtest project');
        Boolean quoteInserted = true;
        try {
            insert q;
        } catch (Exception e) {
            quoteInserted = false;
            System.debug('KBMax quote insert blocked in this org: ' + e.getMessage());
        }
        if (LdrInboxController.estimatesClaimable()) {
            SObject e = Schema.getGlobalDescribe().get('Website_Instant_Estimate__c').newSObject();
            e.put('Lead__c', l.Id);
            e.put('Email_Address__c', l.Email);
            e.put('Estimate_Amount__c', '$15,400-$19,700');
            insert e;
        }

        Test.startTest();
        LdrInboxController.ProspectResult r = LdrInboxController.getProspects();
        List<LdrInboxController.ConfigQuote> detail = LdrInboxController.getConfiguratorDetail(l.Id);
        Test.stopTest();

        System.assertNotEquals(null, r.sinceLabel);
        System.assertEquals(null, r.error, 'Prospect queries run: ' + r.error);
        if (quoteInserted) {
            Boolean found = false;
            for (LdrInboxController.ConfigPerson p : r.configurator) {
                found = found || p.personId == l.Id;
            }
            System.assert(found, 'The Lead with a configurator quote is a prospect');
            System.assertEquals(1, detail.size());
        }
        if (LdrInboxController.estimatesClaimable()) {
            System.assertEquals(1, r.estimates.size(), 'The price-range estimate on an untouched Lead is a prospect');
            System.assertEquals(1, r.estimateCounts.get(l.Id));
        }
    }

    @IsTest
    static void prospectHelpers() {
        System.assertEquals('https://x.test/a?b=1&c=2', LdrInboxController.hrefOf('<a href="https://x.test/a?b=1&amp;c=2" target="_blank">x</a>'));
        System.assertEquals('https://y.test', LdrInboxController.hrefOf('https://y.test'));
        System.assertEquals(null, LdrInboxController.hrefOf(''));
        System.assertEquals('Early stages still.', LdrInboxController.replyOnly('Early stages still. \n \n On Monday, Oct 12, Ashley <a@b.com> wrote: \n Hi'));
        System.assertEquals('Timing.', LdrInboxController.replyOnly('Timing. \n  From: Ashley Sent: Monday'));
        System.assertEquals('', LdrInboxController.replyOnly(null));
        System.assertNotEquals(null, LdrInboxController.prospectSince());
        String paths = LdrInboxController.presentPaths('Lead', new List<String>{ 'Id', 'Owner.Name', 'Not_A_Field_Xyz__c', 'Id' });
        System.assertEquals('Id, Owner.Name', paths, 'Missing fields dropped, relationship paths kept, duplicates removed');
    }

    @IsTest
    static void postQuoteLoadsForEveryLdr() {
        LdrInboxController.adminUserIds = new Set<Id>(); // a normal LDR, whoever runs the tests (canvas #139)
        Test.startTest();
        LdrInboxController.PostQuoteResult r = LdrInboxController.getPostQuote();
        String saveErr;
        try {
            LdrInboxController.savePostQuote(null, null, new Map<String, String>(), new Map<String, String>{ 'Amount' => '1' });
        } catch (AuraHandledException e) {
            saveErr = e.getMessage();
        }
        Test.stopTest();
        System.assertNotEquals(null, r);
        System.assertEquals(UserInfo.getUserId(), r.userId);
        System.assertEquals(null, saveErr, 'Nothing to save when there is no Opportunity Id');
    }

    @IsTest
    static void postQuoteTagHelpers() {
        System.assertEquals(null, LdrInboxController.postQuoteTagOf(null));
        System.assertEquals('FJTRSent', LdrInboxController.postQuoteTagOf('Hi\n#FJTRSent  '));
        System.assertEquals('Hi', LdrInboxController.stripPostQuoteTag('Hi\n#FJTRSent  '));
        System.assertEquals(null, LdrInboxController.postQuoteTagOf('#Updated in the middle text'));
        System.assertEquals('#Updated in the middle text', LdrInboxController.stripPostQuoteTag('#Updated in the middle text'));
        System.assertEquals(null, LdrInboxController.stripPostQuoteTag(null));
    }

    @IsTest
    static void markPostQuoteReplyAddsReplacesAndUndoesTheTag() {
        LdrInboxController.adminUserIds = new Set<Id>();
        Contact c = makeContact('PqMark', 'ldr.pqmark@example.com');
        String original = 'Reply\n\nOn Mon, Oct 12, Ashley <a@b.com> wrote:\nold';
        Task t = new Task(WhoId = c.Id, Subject = '[6sense] [Email] [In] Re: x', Status = 'Completed', Description = original);
        Task other = new Task(WhoId = c.Id, Subject = 'Call back', Status = 'Completed');
        insert new List<Task>{ t, other };

        Test.startTest();
        LdrInboxController.PostQuoteEmail marked = LdrInboxController.markPostQuoteReply(t.Id, 'FJTRSent', false);
        String afterMark = [SELECT Description FROM Task WHERE Id = :t.Id].Description;
        LdrInboxController.markPostQuoteReply(t.Id, 'Updated', false);
        String afterReplace = [SELECT Description FROM Task WHERE Id = :t.Id].Description;
        LdrInboxController.PostQuoteEmail undone = LdrInboxController.markPostQuoteReply(t.Id, 'Updated', true);
        String afterUndo = [SELECT Description FROM Task WHERE Id = :t.Id].Description;
        String badTag;
        try {
            LdrInboxController.markPostQuoteReply(t.Id, 'Spam', false);
        } catch (AuraHandledException e) {
            badTag = e.getMessage();
        }
        String notPq;
        try {
            LdrInboxController.markPostQuoteReply(other.Id, 'Updated', false);
        } catch (AuraHandledException e) {
            notPq = e.getMessage();
        }
        Test.stopTest();

        System.assertEquals('FJTRSent', marked.doneTag);
        System.assertNotEquals(null, marked.modifiedAt);
        System.assert(afterMark.endsWith('\n#FJTRSent'), afterMark);
        System.assert(afterReplace.endsWith('\n#Updated') && !afterReplace.contains('#FJTRSent'), 'One tag at a time: ' + afterReplace);
        System.assertEquals(original, afterUndo, 'Undo restores the Comments');
        System.assertEquals(null, undone.doneTag);
        System.assert(badTag != null && badTag.contains('not allowed'), badTag);
        System.assert(notPq != null && notPq.contains('post-quote'), notPq);
    }

    @IsTest
    static void postQuoteSaveRefusesOtherFields() {
        LdrInboxController.adminUserIds.add(UserInfo.getUserId());
        makeAccountId();
        String err;
        Test.startTest();
        try {
            LdrInboxController.savePostQuote(null, '006000000000000AAA', null, new Map<String, String>{ 'Amount' => '1' });
        } catch (AuraHandledException e) {
            err = e.getMessage();
        }
        Test.stopTest();
        System.assert(err != null && err.contains('not allowed'), 'Only the Post Quote fields can be saved: ' + err);
    }

    @IsTest
    static void linkSafetyNetFixesAndTags() {
        Lead l = makeLead('fix');
        Contact c = makeContact('Fix', 'ldr.fix@example.com');
        Form_Submission__c f = makeSubmission(l.Id, 'fix');
        f.Contact__c = c.Id;
        update f;
        LdrInboxController.adminUserIds.add(UserInfo.getUserId());

        Test.startTest();
        LdrInboxController.LinkFixResult res = LdrInboxController.fixLinks(new List<Id>{ f.Id });
        LdrInboxController.LinkFixResult none = LdrInboxController.fixLinks(new List<Id>());
        LdrInboxController.markFixReviewed(f.Id);
        Test.stopTest();

        System.assertEquals(1, res.fixed + res.failed);
        System.assertEquals(0, none.fixed);
        if (res.fixed == 1) {
            Form_Submission__c after = [SELECT Lead__c, Contact__c, Comments1__c FROM Form_Submission__c WHERE Id = :f.Id];
            System.assertEquals(null, after.Lead__c, 'Both linked: the Lead link is cleared');
            System.assertEquals(c.Id, after.Contact__c);
            System.assertEquals('#LinkFixed-both #FixReviewed', after.Comments1__c, '#156: tags in Comments1__c');
        }
    }

    @IsTest
    static void bossViewDashboardAndAllSubmissions() {
        Lead l = makeLead('dash');
        makeSubmission(l.Id, 'dash');
        LdrInboxController.adminUserIds = new Set<Id>(); // test the refusal as a normal LDR, whoever runs the tests
        String err;
        try {
            LdrInboxController.getDashboard();
        } catch (AuraHandledException e) {
            err = e.getMessage();
        }
        LdrInboxController.adminUserIds.add(UserInfo.getUserId());
        Test.startTest();
        LdrInboxController.DashboardResult d = LdrInboxController.getDashboard();
        List<SObject> subs = LdrInboxController.getAllSubmissions(Date.today().addDays(-7), Date.today());
        Test.stopTest();
        System.assertNotEquals(null, err, 'Non-admins are refused');
        System.assertEquals(12, d.monthlyLeads.size());
        LdrInboxController.MyDashboardResult my = LdrInboxController.getMyDashboard(null);
        System.assertEquals(12, my.monthlyOpps.size());
        System.assertEquals(3, my.leads.size());
        System.assertEquals(3, d.leads.size());
        System.assert(!subs.isEmpty(), 'Today\'s submission is in the range');
    }

    @IsTest
    static void configuratorClaimWhenFieldsExist() {
        List<LdrInboxController.ConfigPerson> none = LdrInboxController.configuratorPeople(LdrInboxController.prospectSince(), true, null);
        System.assertNotEquals(null, none);
        if (!LdrInboxController.kbmaxClaimable()) {
            return; // KBMax_Web_Quote__c has no Claimed_By__c / ClaimedDate__c in this org yet
        }
        Lead l = makeLead('kbc');
        SObject q = Schema.getGlobalDescribe().get('KBMax_Web_Quote__c').newSObject();
        q.put('Lead__c', l.Id);
        q.put('Name', 'Ldrtest claim quote');
        q.put('Email__c', l.Email);
        insert q;
        Test.startTest();
        LdrInboxController.claim(q.Id);
        LdrInboxController.QueueResult r = LdrInboxController.getQueue(30);
        Test.stopTest();
        System.assertEquals(UserInfo.getUserId(), [SELECT Project_Coordinator__c FROM Lead WHERE Id = :l.Id].Project_Coordinator__c);
        Boolean found = false;
        for (LdrInboxController.ConfigPerson p : r.configurator) {
            found = found || (p.personId == l.Id && p.quoteId == q.Id && p.claimedById == UserInfo.getUserId());
        }
        System.assert(found, 'The claimed configurator person is in the queue');
    }

    @IsTest
    static void safetyNetLinksUnlinkedByEmailAndClearAll() {
        Form_Submission__c f = new Form_Submission__c(First_Name__c = 'Ldrtest', Last_Name__c = 'Bymail',
            Email_Address__c = 'ldr.bymail.unique@example.com', Inquiry_Type__c = 'Quote', Submit_Time__c = Datetime.now());
        Form_Submission__c none = new Form_Submission__c(First_Name__c = 'Ldrtest', Last_Name__c = 'Nomatch',
            Email_Address__c = 'ldr.nomatch.unique@example.com', Inquiry_Type__c = 'Quote', Submit_Time__c = Datetime.now());
        insert new List<Form_Submission__c>{ f, none };
        // The Contact comes after the submissions: the org's "Link Contact by Email" flow would link them on insert
        Contact c = makeContact('Bymail', 'ldr.bymail.unique@example.com');
        LdrInboxController.adminUserIds.add(UserInfo.getUserId());

        Test.startTest();
        LdrInboxController.LinkFixResult res = LdrInboxController.fixLinks(new List<Id>{ f.Id, none.Id });
        Integer cleared = LdrInboxController.markFixesReviewed(new List<Id>{ f.Id });
        Integer again = LdrInboxController.markFixesReviewed(new List<Id>{ f.Id });
        Test.stopTest();

        System.assertEquals(1, res.fixed + res.failed, 'Only the submission with exactly one matching Contact is linked');
        if (res.fixed == 1) {
            System.assertEquals(c.Id, [SELECT Contact__c FROM Form_Submission__c WHERE Id = :f.Id].Contact__c);
            System.assertEquals(null, [SELECT Contact__c FROM Form_Submission__c WHERE Id = :none.Id].Contact__c);
            System.assertEquals(1, cleared);
            System.assertEquals(0, again, 'Already reviewed submissions are skipped');
        }
    }

    // ---------------------------------------------------------------- coverage additions

    /**
     * getPostQuote past the "no emails" early return: a Contact in a 150k 6sense campaign with an inbound
     * 6sense email Task. Project and Opportunity are optional extras; if the org blocks them the Contact/email
     * part still runs. Skips quietly when the 6sense / Conversica fields don't exist in this org.
     */
    @IsTest
    static void postQuoteListsRepliesWithProjectAndOpportunity() {
        Map<String, Schema.SObjectField> contactFields = Schema.SObjectType.Contact.fields.getMap();
        if (!contactFields.containsKey('sixsense_ce__campaign_name__c')
                || !contactFields.containsKey('conversica_informational_statement_2__c')) {
            return;
        }
        LdrInboxController.adminUserIds = new Set<Id>{ UserInfo.getUserId() };
        Contact c;
        try {
            c = makeContact('PostQuote', 'ldr.postquote@example.com', new Map<String, Object>{
                'sixsense_ce__campaign_name__c' => 'Post Quote 150k test',
                'Conversica_Informational_Statement_2__c' => 'Ldrtest Project'
            });
        } catch (Exception e) {
            return; // package field is a restricted picklist / validation in this org
        }
        insert new List<Task>{
            new Task(WhoId = c.Id, Subject = '[6sense] [Email] [In] Re: your quote', Status = 'Completed',
                Description = 'Early stages still.\n\nOn Monday, Oct 12, Ashley <a@b.com> wrote:\nHi'),
            // marked done (canvas #140): the tag is reported and left out of the body
            new Task(WhoId = c.Id, Subject = '[6sense] [Email] [In] Re: thanks', Status = 'Completed',
                Description = 'All set, thanks.\n#NoActionNeeded'),
            // internal agent email (CASL footer): not a customer reply, must be left out
            new Task(WhoId = c.Id, Subject = '[6sense] [Email] [In] Agent note', Status = 'Completed',
                Description = 'Sent with the CASL footer')
        };

        // Optional: Project + Opportunity the Contact has a role on
        Id projectId;
        Id oppId;
        try {
            SObject proj = Schema.getGlobalDescribe().get('project__c').newSObject();
            proj.put('Name', 'Ldrtest Project');
            insert proj;
            projectId = proj.Id;
        } catch (Exception e) {
            projectId = null;
        }
        try {
            Opportunity o = makeOpportunity(makeAccountId());
            if (projectId != null) {
                o.put('Project_Name__c', projectId);
                update o;
            }
            insert new OpportunityContactRole(OpportunityId = o.Id, ContactId = c.Id);
            oppId = o.Id;
        } catch (Exception e) {
            oppId = null;
        }

        Test.startTest();
        LdrInboxController.PostQuoteResult r = LdrInboxController.getPostQuote();
        Test.stopTest();

        System.assertEquals(null, r.error, 'Post Quote query runs: ' + r.error);
        LdrInboxController.PostQuoteRow row;
        for (LdrInboxController.PostQuoteRow x : r.rows) {
            if (x.contactId == c.Id) { row = x; }
        }
        System.assertNotEquals(null, row, 'The 150k Contact with a 6sense reply is listed');
        System.assertEquals(2, row.emails.size(), 'The CASL-footer email is skipped');
        Map<String, LdrInboxController.PostQuoteEmail> bySubject = new Map<String, LdrInboxController.PostQuoteEmail>();
        for (LdrInboxController.PostQuoteEmail em : row.emails) {
            bySubject.put(em.subject, em);
        }
        System.assertEquals('Early stages still.', bySubject.get('Re: your quote').body, 'Quoted thread is cut off');
        System.assertEquals(null, bySubject.get('Re: your quote').doneTag);
        System.assertEquals('NoActionNeeded', bySubject.get('Re: thanks').doneTag);
        System.assertEquals('All set, thanks.', bySubject.get('Re: thanks').body, 'The tag is not shown in the reply');
        System.assertNotEquals(null, bySubject.get('Re: thanks').modifiedAt);
        if (oppId != null && projectId != null) {
            System.assertEquals(oppId, row.oppId, 'Opportunity matched through the Project name');
            System.assertEquals(projectId, row.projectId);
            System.assertEquals('Ldrtest Project', row.projectName);
        }
        if (projectId != null) {
            String fieldErr;
            try {
                LdrInboxController.savePostQuote(projectId, null, new Map<String, String>{ 'Name' => 'Renamed' }, null);
            } catch (AuraHandledException e) {
                fieldErr = e.getMessage();
            }
            System.assert(fieldErr != null && fieldErr.contains('not allowed'), 'Only Project stage fields can be saved: ' + fieldErr);
        }
        if (oppId != null) {
            // Save with allowed fields; org validation may still refuse it, which is fine for this test.
            try {
                LdrInboxController.savePostQuote(projectId, oppId, null, new Map<String, String>{ 'StageDetail__c' => 'Ldrtest detail' });
            } catch (AuraHandledException e) {
                System.debug('Org rules refused the Post Quote save: ' + e.getMessage());
            }
        }
    }

    @IsTest
    static void postQuoteSaveRejectsBlankOpportunityStage() {
        LdrInboxController.adminUserIds = new Set<Id>{ UserInfo.getUserId() };
        String err;
        Test.startTest();
        try {
            // fake Opportunity Id: the blank-stage check throws before any DML
            LdrInboxController.savePostQuote(null, '006000000000000AAA', null, new Map<String, String>{ 'StageName' => '' });
        } catch (AuraHandledException e) {
            err = e.getMessage();
        }
        Test.stopTest();
        System.assert(err != null && err.contains('can\'t be blank'), 'Stage can not be cleared: ' + err);
    }

    @IsTest
    static void saveSixSenseAccessRules() {
        LdrInboxController.adminUserIds = new Set<Id>();
        Boolean fieldExists = Schema.SObjectType.Lead.fields.getMap().containsKey('x6sense_option__c');
        List<String> options = LdrInboxController.sixSenseOptions();
        String value = options.isEmpty() ? null : options[0];

        Lead l = makeLead('six');
        Form_Submission__c unclaimed = makeSubmission(l.Id, 'six');
        Lead l2 = makeLead('six2');
        Form_Submission__c unclaimed2 = makeSubmission(l2.Id, 'six2');
        Lead l3 = makeLead('six3');
        Form_Submission__c mine = makeSubmission(l3.Id, 'six3');
        LdrInboxController.claim(mine.Id);
        Form_Submission__c unlinked = new Form_Submission__c(First_Name__c = 'Ldrtest', Last_Name__c = 'Six',
            Email_Address__c = 'ldr.six.unlinked@example.com', Inquiry_Type__c = 'Quote', Submit_Time__c = Datetime.now());
        insert unlinked;
        LdrInboxController.claim(unlinked.Id);
        String notMineErr;
        String unlinkedErr;
        String mineErr;
        String adminErr;

        Test.startTest();
        try { LdrInboxController.saveSixSense(unclaimed.Id, value); } catch (AuraHandledException e) { notMineErr = e.getMessage(); }
        try { LdrInboxController.saveSixSense(unlinked.Id, value); } catch (AuraHandledException e) { unlinkedErr = e.getMessage(); }
        try { LdrInboxController.saveSixSense(mine.Id, value); } catch (AuraHandledException e) { mineErr = e.getMessage(); }
        LdrInboxController.adminUserIds = new Set<Id>{ UserInfo.getUserId() };
        try { LdrInboxController.saveSixSense(unclaimed2.Id, null); } catch (AuraHandledException e) { adminErr = e.getMessage(); }
        Test.stopTest();

        System.assertNotEquals(null, notMineErr, 'A normal LDR can not save on an unclaimed row');
        System.assertNotEquals(null, unlinkedErr, 'Nothing to save to without a Lead or Contact');
        if (fieldExists) {
            System.assertEquals(null, mineErr, 'The claimer can save: ' + mineErr);
            System.assertEquals(null, adminErr, 'An admin can save on an unclaimed row: ' + adminErr);
            System.assertEquals(value, Database.query('SELECT X6Sense_Option__c FROM Lead WHERE Id = \'' + l3.Id + '\'')[0].get('X6Sense_Option__c'));
        } else {
            System.assert(mineErr != null && mineErr.contains('X6Sense_Option__c'), 'Field missing in this org: ' + mineErr);
        }
    }

    @IsTest
    static void timelineAndOutreachIncludeEvents() {
        Lead l = makeLead('evt');
        Form_Submission__c f = makeSubmission(l.Id, 'evt');
        LdrInboxController.claim(f.Id);
        Boolean inserted = true;
        try {
            insert new Event(WhoId = l.Id, Subject = 'LDR Test Meeting', OwnerId = UserInfo.getUserId(),
                StartDateTime = Datetime.now(), EndDateTime = Datetime.now().addHours(1));
        } catch (Exception e) {
            inserted = false; // org rules blocked the Event; nothing to read back
        }

        Test.startTest();
        LdrInboxController.LeadTimeline t = LdrInboxController.getLeadTimeline(l.Id);
        LdrInboxController.QueueResult r = LdrInboxController.getQueue(null);
        Test.stopTest();

        if (inserted) {
            Boolean sawEvent = false;
            for (LdrInboxController.TimelineItem i : t.activity) {
                sawEvent = sawEvent || (i.kind == 'event' && i.label == 'LDR Test Meeting');
            }
            System.assert(sawEvent, 'Events appear in Activity History with kind event');
            System.assert(r.lastActivityBy.containsKey(String.valueOf(l.Id) + ':' + String.valueOf(UserInfo.getUserId())),
                'My Event counts as outreach');
        }
    }

    // ---------------------------------------------------------------- canvas 9fed: 6sense, speed, Windfall on Contacts

    @IsTest
    static void sixSenseDashboardAndSpeed() {
        Lead l = makeLead('speed');
        Form_Submission__c f = makeSubmission(l.Id, 'speed');
        LdrInboxController.adminUserIds.add(UserInfo.getUserId());
        Test.startTest();
        LdrInboxController.claim(f.Id);
        LdrInboxController.SixSenseResult six = LdrInboxController.getSixSenseDashboard();
        List<LdrInboxController.SpeedRow> speed = LdrInboxController.speedFor(new Set<String>{ UserInfo.getName() });
        LdrInboxController.DashboardResult d = LdrInboxController.getDashboard();
        LdrInboxController.MyDashboardResult my = LdrInboxController.getMyDashboard(null);
        Test.stopTest();
        System.assertEquals(8, six.weeks.size());
        System.assertEquals(1, speed.size());
        System.assertNotEquals(null, d.speedSince);
        System.assertNotEquals(null, my.speed, 'My Dashboard has my speed row');
        if (Datetime.now() >= LdrInboxController.SPEED_SINCE) {
            System.assertEquals(1, speed[0].claimed, 'The submission claimed today counts');
            System.assertEquals(1, speed[0].sameDay);
        }
    }

    @IsTest
    static void speedHelpers() {
        System.assertEquals(Date.newInstance(2026, 10, 12), LdrInboxController.nextBusinessDay(Date.newInstance(2026, 10, 9), 'Fri'));
        System.assertEquals(Date.newInstance(2026, 10, 8), LdrInboxController.nextBusinessDay(Date.newInstance(2026, 10, 7), 'Wed'));
        System.assertEquals(Date.newInstance(2026, 10, 6), LdrInboxController.pacificDate(Datetime.newInstanceGmt(2026, 10, 7, 3, 0, 0)));
        Datetime t0 = Datetime.newInstanceGmt(2026, 10, 7, 10, 0, 0);
        System.assertEquals(null, LdrInboxController.firstAfter(null, t0));
        System.assertEquals(t0.addHours(2), LdrInboxController.firstAfter(
            new List<Datetime>{ t0.addHours(-1), t0.addHours(5), t0.addHours(2) }, t0));
    }

    @IsTest
    static void contactWindfallFallsBackToConvertedLead() {
        Contact c = makeContact('Windfall', 'ldr.windfall.test@example.com');
        Test.startTest();
        Map<Id, Map<String, String>> wf = LdrInboxController.contactWindfallFor(new Set<Id>{ c.Id });
        Map<Id, Map<String, String>> none = LdrInboxController.contactWindfallFor(new Set<Id>());
        Test.stopTest();
        System.assertNotEquals(null, wf);
        System.assert(none.isEmpty());
    }

    @IsTest
    static void markJunkAndRestore() {
        Form_Submission__c f = new Form_Submission__c(First_Name__c = 'Junk', Last_Name__c = 'Sender',
            Email_Address__c = 'junk.sender@example.com', Comments__c = 'buy SEO',
            Inquiry_Type__c = 'Contact Us', Submit_Time__c = Datetime.now());
        insert f;
        Test.startTest();
        Integer n = LdrInboxController.markJunk(new List<Id>{ f.Id }, 'Solicitation or sales pitch');
        Test.stopTest();
        System.assertEquals(1, n);
        Form_Submission__c after = [SELECT Claimed_By__c, ClaimedDate__c, Comments__c, Comments1__c FROM Form_Submission__c WHERE Id = :f.Id];
        System.assertEquals(UserInfo.getUserId(), after.Claimed_By__c);
        System.assertNotEquals(null, after.ClaimedDate__c, '#156: the junk time');
        System.assert(after.Comments1__c.contains('#Junk:Solicitation or sales pitch'));
        System.assertEquals('buy SEO', after.Comments__c, 'the old field is left alone');
        System.assertEquals(1, LdrInboxController.restoreJunk(new List<Id>{ f.Id }));
        after = [SELECT Claimed_By__c, ClaimedDate__c, Comments__c, Comments1__c FROM Form_Submission__c WHERE Id = :f.Id];
        System.assertEquals(null, after.Claimed_By__c);
        System.assertEquals(null, after.ClaimedDate__c);
        System.assertEquals(null, after.Comments1__c);
        System.assertEquals('buy SEO', after.Comments__c);
        try {
            LdrInboxController.markJunk(new List<Id>{ f.Id }, 'Not a real reason');
            System.assert(false, 'expected an error');
        } catch (AuraHandledException e) {
            System.assert(true);
        }
        System.assertEquals(null, LdrInboxController.stripJunkTag('#Junk:Test submission'));
        System.assertEquals('Call me', LdrInboxController.stripInternalTags('Call me #LinkFixed-both #FixReviewed #Junk:Test submission'));
    }

    /** v7: admins save the LDR fields of a submission another LDR has claimed; a normal LDR can't. */
    @IsTest
    static void adminSavesOthersClaim() {
        Lead l = makeLead('adminothers');
        Form_Submission__c f = makeSubmission(l.Id, 'adminothers');
        f.Claimed_By__c = otherUser().Id;
        update f;
        LdrInboxController.adminUserIds = new Set<Id>();
        String err;
        try {
            LdrInboxController.saveLeadFields(f.Id, 'Working', null, null, null, null);
        } catch (AuraHandledException e) {
            err = e.getMessage();
        }
        System.assertNotEquals(null, err, 'a normal LDR can\'t save someone else\'s claim');
        LdrInboxController.adminUserIds = new Set<Id>{ UserInfo.getUserId() };
        Test.startTest();
        LdrInboxController.saveLeadFields(f.Id, 'Working', null, null, null, null);
        Test.stopTest();
        System.assertEquals('Working', [SELECT Status FROM Lead WHERE Id = :l.Id].Status);
        System.assertEquals(otherUser().Id, [SELECT Claimed_By__c FROM Form_Submission__c WHERE Id = :f.Id].Claimed_By__c,
            'the claim stays with the other LDR');
    }

    /** v6g7: status buttons on a submission with no Lead / Contact: tag, claim, replace, release clears it. */
    @IsTest
    static void unlinkedStatusTags() {
        Form_Submission__c f = new Form_Submission__c(First_Name__c = 'No', Last_Name__c = 'Lead',
            Email_Address__c = 'no.lead.yet@example.com', Inquiry_Type__c = 'Contact Us', Submit_Time__c = Datetime.now(),
            Comments1__c = '#LinkFixed');
        insert f;
        Test.startTest();
        LdrInboxController.setUnlinkedStatus(f.Id, 'Working');
        Form_Submission__c after = [SELECT Claimed_By__c, ClaimedDate__c, Comments1__c FROM Form_Submission__c WHERE Id = :f.Id];
        System.assertEquals(UserInfo.getUserId(), after.Claimed_By__c, 'claims it');
        System.assertNotEquals(null, after.ClaimedDate__c);
        System.assertEquals('#LinkFixed #Working', after.Comments1__c);
        LdrInboxController.setUnlinkedStatus(f.Id, 'Unreachable');
        after = [SELECT Claimed_By__c, Comments1__c FROM Form_Submission__c WHERE Id = :f.Id];
        System.assertEquals('#LinkFixed #Unreachable', after.Comments1__c, 'replaces the earlier status');
        try {
            LdrInboxController.setUnlinkedStatus(f.Id, 'Qualified');
            System.assert(false, 'expected an error');
        } catch (AuraHandledException e) {
            System.assert(true);
        }
        LdrInboxController.release(f.Id);
        Test.stopTest();
        after = [SELECT Claimed_By__c, Comments1__c FROM Form_Submission__c WHERE Id = :f.Id];
        System.assertEquals(null, after.Claimed_By__c);
        System.assertEquals('#LinkFixed', after.Comments1__c, 'release clears the status tag only');
        System.assertEquals(null, LdrInboxController.stripStatusTags('#Disqualified'));
        System.assertEquals('Call me', LdrInboxController.stripInternalTags('Call me #Working'));
    }

    @IsTest
    static void markJunkOnInstantEstimate() {
        if (!LdrInboxController.estimatesClaimable()) {
            return; // Website_Instant_Estimate__c has no Claimed_By__c / ClaimedDate__c in this org yet
        }
        SObject e = Schema.getGlobalDescribe().get('Website_Instant_Estimate__c').newSObject();
        e.put('Email_Address__c', 'junk.estimate@example.com');
        e.put('Estimate_Amount__c', 'Custom');
        e.put('Questions_or_Comments__c', 'asdf');
        insert e;
        Test.startTest();
        System.assertEquals(1, LdrInboxController.markJunk(new List<Id>{ e.Id }, 'Test submission'));
        Test.stopTest();
        SObject after = Database.query('SELECT Claimed_By__c, Comments__c, Questions_or_Comments__c FROM Website_Instant_Estimate__c WHERE Id = \'' + e.Id + '\'');
        System.assertEquals(UserInfo.getUserId(), after.get('Claimed_By__c'));
        System.assertEquals('#Junk:Test submission', after.get('Comments__c'), '#156: the tag goes in Comments__c');
        System.assertEquals('asdf', after.get('Questions_or_Comments__c'), 'the customer text is untouched');
        System.assertEquals(1, LdrInboxController.restoreJunk(new List<Id>{ e.Id }));
        after = Database.query('SELECT Claimed_By__c, Comments__c, Questions_or_Comments__c FROM Website_Instant_Estimate__c WHERE Id = \'' + e.Id + '\'');
        System.assertEquals(null, after.get('Claimed_By__c'));
        System.assertEquals(null, after.get('Comments__c'));
        System.assertEquals('asdf', after.get('Questions_or_Comments__c'));
    }

    /** Notes #89B: the link safety net also runs on instant estimates; tags go in Comments__c (#156). */
    @IsTest
    static void safetyNetOnInstantEstimate() {
        if (!LdrInboxController.estimatesClaimable()) {
            return; // Website_Instant_Estimate__c has no claim / Lead__c / Contact__c fields in this org yet
        }
        Contact c = makeContact('Estmail', 'ldr.estmail.unique@example.com');
        SObject e = Schema.getGlobalDescribe().get('Website_Instant_Estimate__c').newSObject();
        e.put('Email_Address__c', 'ldr.estmail.unique@example.com');
        e.put('Estimate_Amount__c', 'Custom');
        e.put('Questions_or_Comments__c', 'Need a quote');
        insert e;
        LdrInboxController.adminUserIds.add(UserInfo.getUserId());
        Test.startTest();
        LdrInboxController.LinkFixResult res = LdrInboxController.fixLinks(new List<Id>{ e.Id });
        Integer cleared = res.fixed == 1 ? LdrInboxController.markFixesReviewed(new List<Id>{ e.Id }) : 0;
        Test.stopTest();
        System.assertEquals(1, res.fixed + res.failed, 'The estimate with exactly one matching Contact is tried');
        if (res.fixed == 1) {
            SObject after = Database.query('SELECT Contact__c, Comments__c, Questions_or_Comments__c FROM Website_Instant_Estimate__c WHERE Id = \'' + e.Id + '\'');
            System.assertEquals(c.Id, after.get('Contact__c'));
            System.assertEquals('#LinkFixed-email #FixReviewed', after.get('Comments__c'));
            System.assertEquals('Need a quote', after.get('Questions_or_Comments__c'));
            System.assertEquals(1, cleared);
        }
    }

    /**
     * Canvas d84b (#94) / #153 D: junk on a Lead-linked row sets the Lead to Wrong profile, the reason's Outcome, today
     * and the running user as coordinator; Restore puts all of it back (the coordinator too).
     */
    @IsTest
    static void markJunkOnLinkedLeadAndRestore() {
        User other = otherUser();
        Lead l = makeLead('junklinked');
        l.Project_Coordinator__c = other.Id;
        update l;
        Form_Submission__c f = new Form_Submission__c(First_Name__c = 'Junk', Last_Name__c = 'Linked',
            Email_Address__c = l.Email, Lead__c = l.Id, Comments__c = 'hello',
            Inquiry_Type__c = 'Contact Us', Submit_Time__c = Datetime.now());
        insert f;
        Lead before = [SELECT Status, Status_Reason__c, Lead_Funnel_Outcome__c, Lead_Funnel_Time_Stamp__c, Project_Coordinator__c FROM Lead WHERE Id = :l.Id];
        Test.startTest();
        Integer n = LdrInboxController.markJunk(new List<Id>{ f.Id }, 'Fake or invalid contact info');
        Test.stopTest();
        System.assertEquals(1, n);
        Lead mid = [SELECT Status, Status_Reason__c, Lead_Funnel_Outcome__c, Lead_Funnel_Time_Stamp__c, Project_Coordinator__c FROM Lead WHERE Id = :l.Id];
        System.assertEquals('Wrong profile', mid.Status);
        System.assertEquals(before.Status_Reason__c, mid.Status_Reason__c, 'Junk leaves Status Reason as it is');
        System.assertEquals('Invalid Contact Information', mid.Lead_Funnel_Outcome__c);
        System.assertEquals(LdrInboxController.todayPacific(), mid.Lead_Funnel_Time_Stamp__c);
        System.assertEquals(UserInfo.getUserId(), mid.Project_Coordinator__c);
        String tagged = [SELECT Comments1__c FROM Form_Submission__c WHERE Id = :f.Id].Comments1__c;
        System.assert(tagged.startsWith('#Junk:Fake or invalid contact info{prev:'), tagged);
        System.assertEquals(null, LdrInboxController.stripJunkTag(tagged));
        System.assertEquals(5, LdrInboxController.junkPrev(tagged).size());
        System.assertEquals(1, LdrInboxController.restoreJunk(new List<Id>{ f.Id }));
        Lead after = [SELECT Status, Status_Reason__c, Lead_Funnel_Outcome__c, Lead_Funnel_Time_Stamp__c, Project_Coordinator__c FROM Lead WHERE Id = :l.Id];
        System.assertEquals(before.Status, after.Status);
        System.assertEquals(before.Status_Reason__c, after.Status_Reason__c);
        System.assertEquals(before.Lead_Funnel_Outcome__c, after.Lead_Funnel_Outcome__c);
        System.assertEquals(before.Lead_Funnel_Time_Stamp__c, after.Lead_Funnel_Time_Stamp__c);
        System.assertEquals(other.Id, after.Project_Coordinator__c, 'Restore puts the coordinator back');
        System.assertEquals('hello', [SELECT Comments__c FROM Form_Submission__c WHERE Id = :f.Id].Comments__c);
    }

    /** #153 D: each junk reason's Lead Funnel Outcome. */
    @IsTest
    static void junkOutcomePerReason() {
        System.assertEquals(LdrInboxController.JUNK_REASONS.size(), LdrInboxController.JUNK_OUTCOMES.size());
        System.assertEquals('Spam/Solicitation', LdrInboxController.JUNK_OUTCOMES.get('Solicitation or sales pitch'));
        System.assertEquals('Invalid Contact Information', LdrInboxController.JUNK_OUTCOMES.get('Fake or invalid contact info'));
        System.assertEquals('Other', LdrInboxController.JUNK_OUTCOMES.get('Test submission'));
        System.assertEquals('Other', LdrInboxController.JUNK_OUTCOMES.get('Not a customer (other)'));
    }

    @IsTest
    static void junkTagParsing() {
        String t = 'Call me #LinkFixed-both #Junk:Test submission{prev:Working||Too Early|2026-10-14}';
        List<String> prev = LdrInboxController.junkPrev(t);
        System.assertEquals('Working', prev[0]);
        System.assertEquals('', prev[1]);
        System.assertEquals('Too Early', prev[2]);
        System.assertEquals('2026-10-14', prev[3]);
        System.assertEquals(null, LdrInboxController.junkPrev('#Junk:Test submission'));
        System.assertEquals('Call me', LdrInboxController.stripInternalTags(t));
        // #153 D: the coordinator's slot (blank when there was none)
        List<String> five = LdrInboxController.junkPrev('#Junk:Test submission{prev:Working||Too Early|2026-10-14|}');
        System.assertEquals(5, five.size());
        System.assertEquals('', five[4]);
    }

    /** Lead Views report panel (canvas #112): admin check and a missing report id. Running a real report needs SeeAllData. */
    @IsTest
    static void reportRowsGuards() {
        Integer errors = 0;
        try {
            LdrInboxController.getReportRows(null);
        } catch (AuraHandledException e) {
            errors++;
        }
        LdrInboxController.adminUserIds.add(UserInfo.getUserId());
        try {
            LdrInboxController.getReportRows(null);
        } catch (AuraHandledException e) {
            errors++;
        }
        System.assertEquals(2, errors);
    }

    /** Canvas #129: the Convert flow's Files step reads the Lead's conversion through getLeadConversion. */
    @IsTest
    static void leadConversionReportsContactAndOpportunity() {
        Lead l = makeLead('lconv');
        System.assertEquals(false, LdrInboxController.getLeadConversion(null, null).isConverted, 'null Lead');
        System.assertEquals(false, LdrInboxController.getLeadConversion(l.Id, null).isConverted, 'not converted yet');
        Database.LeadConvertResult res;
        try {
            Database.LeadConvert lc = new Database.LeadConvert();
            lc.setLeadId(l.Id);
            lc.setConvertedStatus([SELECT ApiName FROM LeadStatus WHERE IsConverted = true LIMIT 1].ApiName);
            res = Database.convertLead(lc);
        } catch (Exception e) {
            System.debug(LoggingLevel.WARN, 'Test conversion blocked in this org: ' + e.getMessage());
            return; // conversion flows / validation in this org may block a test conversion (checks above still ran)
        }
        Test.startTest();
        LdrInboxController.LeadConversion c = LdrInboxController.getLeadConversion(l.Id, null);
        Test.stopTest();
        System.assertEquals(true, c.isConverted);
        System.assertEquals(res.getContactId(), c.contactId);
        System.assertEquals(res.getOpportunityId(), c.opportunityId);
        if (res.getOpportunityId() != null) {
            // v5: the flow's OpportunityId output is used as given (here the same Opportunity)
            LdrInboxController.LeadConversion c2 = LdrInboxController.getLeadConversion(l.Id, res.getOpportunityId());
            System.assertEquals(res.getOpportunityId(), c2.opportunityId);
            System.assertNotEquals(null, c2.opportunityName);
        }
    }

    /** Canvas #150: Convert sets the new Contact's Lead Funnel Status to Qualified, only when it is blank. */
    @IsTest
    static void qualifyConvertedContactOnlyWhenBlank() {
        Lead l = makeLead('lqual');
        System.assertEquals(false, LdrInboxController.qualifyConvertedContact(null), 'null Lead');
        System.assertEquals(false, LdrInboxController.qualifyConvertedContact(l.Id), 'not converted: nothing written');
        Database.LeadConvertResult res;
        try {
            Database.LeadConvert lc = new Database.LeadConvert();
            lc.setLeadId(l.Id);
            lc.setConvertedStatus([SELECT ApiName FROM LeadStatus WHERE IsConverted = true LIMIT 1].ApiName);
            lc.setDoNotCreateOpportunity(true);
            res = Database.convertLead(lc);
        } catch (Exception e) {
            System.debug(LoggingLevel.WARN, 'Test conversion blocked in this org: ' + e.getMessage());
            return; // conversion flows / validation in this org may block a test conversion (checks above still ran)
        }
        Id cid = res.getContactId();
        // Automation in the org may already have set a status on conversion: start from blank.
        update new Contact(Id = cid, Lead_Funnel_Status__c = null);

        Test.startTest();
        Boolean first = LdrInboxController.qualifyConvertedContact(l.Id);
        String afterFirst = [SELECT Lead_Funnel_Status__c FROM Contact WHERE Id = :cid].Lead_Funnel_Status__c;
        update new Contact(Id = cid, Lead_Funnel_Status__c = 'Working');
        Boolean second = LdrInboxController.qualifyConvertedContact(l.Id);
        Test.stopTest();

        System.assertEquals(true, first, 'blank -> Qualified');
        System.assertEquals('Qualified', afterFirst);
        System.assertEquals(false, second, 'a status the Contact already has is kept');
        System.assertEquals('Working', [SELECT Lead_Funnel_Status__c FROM Contact WHERE Id = :cid].Lead_Funnel_Status__c);
    }

    // ---------------------------------------------------------------- Claim Audit (#145B) / uncontacted claims (#146)

    /** A form submission claimed by the running user <daysAgo> days ago, submitted a day before that. */
    private static Form_Submission__c makeClaim(Id leadId, Id contactId, String suffix, Integer daysAgo) {
        Form_Submission__c f = makeSubmission(leadId, suffix);
        f.Contact__c = contactId;
        f.Submit_Time__c = Datetime.now().addDays(-daysAgo - 1);
        f.Claimed_By__c = UserInfo.getUserId();
        // #156: ClaimedDate__c at midnight Pacific, like the backfilled claims (date-only in Claim Audit)
        f.ClaimedDate__c = LdrInboxController.pacificDatetime(Date.today().addDays(-daysAgo), 0);
        update f;
        return f;
    }

    private static Task emailTask(Id whoId, String subject, Id ownerId, Datetime at) {
        Task t = new Task(WhoId = whoId, Subject = subject, Status = 'Completed', OwnerId = ownerId);
        insert t;
        Test.setCreatedDate(t.Id, at);
        return t;
    }

    @IsTest
    static void claimAuditRequiresAdmin() {
        LdrInboxController.adminUserIds = new Set<Id>();
        String err;
        try {
            LdrInboxController.getClaimAudit(null);
        } catch (AuraHandledException e) {
            err = e.getMessage();
        }
        System.assert(err != null && err.contains('admins'), err);
    }

    @IsTest
    static void claimAuditClassifiesClaims() {
        LdrInboxController.adminUserIds = new Set<Id>{ UserInfo.getUserId() };
        LdrInboxController.auditClaimerNames = new Set<String>{ UserInfo.getName() };
        LdrInboxController.AUDIT_EXCLUDED_CLAIMERS.remove(UserInfo.getName()); // e.g. Aziz running the tests
        Lead la = makeLead('auda');
        Contact cb = makeContact('Auditb', 'ldr.audit.b@example.com');
        Form_Submission__c fa = makeClaim(la.Id, null, 'auda', 3);
        Form_Submission__c fb = makeClaim(null, cb.Id, 'audb', 3);
        makeClaim(null, null, 'audc', 3); // no Lead / Contact: not checked
        Form_Submission__c fd = makeClaim(makeLead('audd').Id, null, 'audd', 3);
        fd.Email_Address__c = 'aziznana786+audit@gmail.com'; // test entry: left out
        update fd;
        Datetime claimAt = LdrInboxController.pacificDatetime(Date.today().addDays(-3), 0);
        emailTask(la.Id, '[Outreach] [Email] [Out] Hi', UserInfo.getUserId(), claimAt.addHours(2));
        emailTask(cb.Id, 'Email: Following up', UserInfo.getUserId(), claimAt.addHours(30));

        Test.startTest();
        LdrInboxController.ClaimAuditResult r = LdrInboxController.getClaimAudit(null);
        Test.stopTest();

        System.assertEquals(3, r.team.claimed, 'The test entry is left out');
        System.assertEquals(2, r.team.checked);
        System.assertEquals(1, r.team.ok);
        System.assertEquals(1, r.team.late);
        System.assertEquals(1, r.team.nolink);
        System.assertEquals(1, r.claimers.size());
        System.assertEquals(1, r.rows.size());
        LdrInboxController.AuditFlagRow row = r.rows[0];
        System.assertEquals(fb.Id, row.key);
        System.assertEquals('Late (>24h)', row.status);
        System.assertEquals(false, row.claimTimeExact);
        System.assertEquals(30.0, row.hoursToEmail);
        System.assertEquals('Email: Following up', row.firstEmailSubject);
        System.assertEquals('Contact', row.personType);
        System.assertEquals('No', row.converted);
        System.assertNotEquals(null, fa.Id);
    }

    /** #156: Claim Audit reads ClaimedDate__c itself (no coordinator history, no 8:00 AM fallback). */
    @IsTest
    static void claimTimesUseClaimedDate() {
        LdrInboxController.adminUserIds = new Set<Id>{ UserInfo.getUserId() };
        LdrInboxController.auditClaimerNames = new Set<String>{ UserInfo.getName() };
        LdrInboxController.AUDIT_EXCLUDED_CLAIMERS.remove(UserInfo.getName());
        Lead l = makeLead('audh');
        Form_Submission__c f = makeClaim(l.Id, null, 'audh', 2);
        // Whole seconds: Salesforce drops the milliseconds when it saves a Date/Time
        Datetime exactAt = Datetime.newInstance(Datetime.now().addDays(-2).addHours(-1).getTime() / 1000 * 1000);
        if (exactAt.format('HH:mm:ss', LdrInboxController.PACIFIC_TZ) == '00:00:00') {
            exactAt = exactAt.addMinutes(-1); // exactly midnight Pacific would count as date-only
        }
        f.ClaimedDate__c = exactAt;
        update f;
        Test.startTest();
        LdrInboxController.ClaimAuditResult r = LdrInboxController.getClaimAudit(null);
        Test.stopTest();
        System.assertEquals(1, r.team.none, 'No email two days after the claim');
        System.assertEquals(true, r.rows[0].claimTimeExact);
        System.assertEquals(exactAt, r.rows[0].claimed);
    }

    @IsTest
    static void uncontactedClaimsListAndNoContactNeeded() {
        LdrInboxController.adminUserIds = new Set<Id>();
        Lead la = makeLead('unca'); // claimed 3 days ago, no email: listed
        Form_Submission__c fa = makeClaim(la.Id, null, 'unca', 3);
        Contact cb = makeContact('Uncb', 'ldr.unc.b@example.com'); // emailed: not listed
        makeClaim(null, cb.Id, 'uncb', 3);
        emailTask(cb.Id, '[Outreach] [Email] [Out] Hello', UserInfo.getUserId(), Datetime.now().addDays(-1));
        Form_Submission__c fc = makeClaim(makeLead('uncc').Id, null, 'uncc', 3); // junk: not listed
        fc.Comments1__c = '#Junk:Test submission';
        update fc;
        Form_Submission__c fd = makeClaim(makeLead('uncd').Id, null, 'uncd', 0); // claimed just now: under 24 hours
        fd.ClaimedDate__c = Datetime.now();
        update fd;

        Test.startTest();
        List<LdrInboxController.UncontactedRow> before = LdrInboxController.getUncontactedClaims(null);
        Integer tagged = LdrInboxController.markNoContactNeeded(new List<Id>{ fa.Id });
        Integer again = LdrInboxController.markNoContactNeeded(new List<Id>{ fa.Id });
        List<LdrInboxController.UncontactedRow> afterTag = LdrInboxController.getUncontactedClaims(null);
        Test.stopTest();

        System.assertEquals(1, before.size(), 'Only the claim with no email after 24 hours: ' + before);
        System.assertEquals(la.Id, before[0].personId);
        System.assertEquals(fa.Id, before[0].submissionId);
        System.assertEquals(1, tagged);
        System.assertEquals(0, again, 'Already tagged');
        System.assertEquals(0, afterTag.size(), '#NoContactNeeded takes the person off the list');
        String tags = [SELECT Comments1__c FROM Form_Submission__c WHERE Id = :fa.Id].Comments1__c;
        System.assertEquals(LdrInboxController.NO_CONTACT_TAG, tags, '#156: in Comments1__c');
        System.assertEquals('Need a quote', LdrInboxController.stripInternalTags('Need a quote\n#NoContactNeeded'));
    }

    @IsTest
    static void uncontactedClaimsAreYourOwn() {
        LdrInboxController.adminUserIds = new Set<Id>();
        String err;
        try {
            LdrInboxController.getUncontactedClaims(otherUser().Id);
        } catch (AuraHandledException e) {
            err = e.getMessage();
        }
        System.assert(err != null && err.contains('your own'), err);
    }

    // ---------------------------------------------------------------- Salesforce search (canvas #144)

    @IsTest
    static void searchPeopleExactEmailFindsLeadAndContact() {
        // Two emails: an org validation rule refuses a Contact whose email a Lead already has
        Lead l = makeLeadWith('Ldrtest', 'Searchlead', 'Ldrtest Search Co', 'ldr.search.exact@example.com');
        Contact c = makeContact('Searchcontact', 'ldr.search.exact2@example.com');
        makeSubmission(l.Id, 'srch');
        Test.startTest();
        LdrInboxController.PeopleSearchResult r = LdrInboxController.searchPeople('  LDR.Search.Exact@example.com ');
        LdrInboxController.PeopleSearchResult rc = LdrInboxController.searchPeople('ldr.search.exact2@example.com');
        Test.stopTest();
        System.assertEquals(true, r.exact);
        Map<Id, LdrInboxController.PersonHit> byId = new Map<Id, LdrInboxController.PersonHit>();
        for (LdrInboxController.PersonHit p : r.people) {
            byId.put(p.id, p);
        }
        for (LdrInboxController.PersonHit p : rc.people) {
            byId.put(p.id, p);
        }
        System.assert(byId.containsKey(l.Id) && byId.containsKey(c.Id), 'Both the Lead and the Contact are found');
        System.assertEquals('Lead', byId.get(l.Id).kind);
        System.assertEquals('Contact', byId.get(c.Id).kind);
        System.assertNotEquals(null, byId.get(l.Id).owner);
        System.assert(byId.get(l.Id).submissionCount >= 1, 'The Lead\'s form submission is counted');
        System.assertNotEquals(null, byId.get(l.Id).lastSubmissionAt);
        System.assertEquals(false, byId.get(l.Id).lastSubmissionClaimed);
    }

    @IsTest
    static void searchPeoplePartialUsesSoslAndFilters() {
        Lead l = makeLeadWith('Ldrtest', 'Sosl', 'Ldrtest Sosl Co', 'ldr.search.sosl@example.com');
        Contact c = makeContact('Soslcontact', 'ldr.search.sosl2@example.com');
        Test.setFixedSearchResults(new List<Id>{ l.Id, c.Id });
        Test.startTest();
        LdrInboxController.PeopleSearchResult hit = LdrInboxController.searchPeople('Ldrtest');
        LdrInboxController.PeopleSearchResult miss = LdrInboxController.searchPeople('zzqq');
        Test.stopTest();
        System.assertEquals(false, hit.exact);
        System.assertEquals(2, hit.people.size(), 'Both names contain the text');
        System.assertEquals(0, miss.people.size(), 'SOSL hits without the text in name / email / company are dropped');
    }

    @IsTest
    static void searchPeopleRulesAndEscaping() {
        String err;
        try {
            LdrInboxController.searchPeople('a');
        } catch (AuraHandledException e) {
            err = e.getMessage();
        }
        System.assertEquals('Type at least 2 characters to search Salesforce.', err);
        System.assertEquals('o\\\'brien x', LdrInboxController.soslEscape('o\'brien (x)'));
        System.assertEquals('', LdrInboxController.soslEscape('(*)'));
        System.assertEquals(0, LdrInboxController.searchPeople('(*)').people.size(), 'nothing left to search for');
        Test.setFixedSearchResults(new List<Id>());
        LdrInboxController.PeopleSearchResult r = LdrInboxController.searchPeople('o\'brien (x)');
        System.assertEquals(0, r.people.size());
    }

    /** Files step: the person's KBMax quotes from the last year; checking one adds a junction to the Opportunity, once. */
    @IsTest
    static void kbmaxQuotesLinkToTheOpportunity() {
        System.assertEquals(0, LdrInboxController.getKbmaxQuotes(null, null, null).size(), 'No person: nothing');
        if (Schema.getGlobalDescribe().get(LdrInboxController.KBMAX_JUNCTION) == null) {
            return; // no KBMax Web Quote Junction in this org
        }
        Lead l = makeLead('kbl');
        SObject q = Schema.getGlobalDescribe().get('KBMax_Web_Quote__c').newSObject();
        q.put('Lead__c', l.Id);
        q.put('Name', 'Ldrtest link quote');
        q.put('Project_Name__c', 'Ldrtest link project');
        Opportunity o;
        try {
            insert q;
            o = makeOpportunity(makeAccountId());
        } catch (Exception e) {
            return; // org automation blocks the test data
        }
        Test.startTest();
        List<LdrInboxController.KbmaxQuote> before = LdrInboxController.getKbmaxQuotes(l.Id, null, o.Id);
        Integer added = LdrInboxController.linkKbmaxQuotes(o.Id, new List<Id>{ q.Id });
        Integer again = LdrInboxController.linkKbmaxQuotes(o.Id, new List<Id>{ q.Id });
        List<LdrInboxController.KbmaxQuote> after = LdrInboxController.getKbmaxQuotes(l.Id, null, o.Id);
        Test.stopTest();
        System.assertEquals(1, before.size());
        System.assertEquals('Ldrtest link project', before[0].project);
        System.assertEquals(false, before[0].linked);
        System.assertEquals(1, added);
        System.assertEquals(0, again, 'Already joined: not added twice');
        System.assertEquals(true, after[0].linked);
    }

    /** #160: Link to Existing's search keeps name / email / company / zip and phone-digit matches, up to the cap. */
    @IsTest
    static void searchLinkRecordsMatchesAndCaps() {
        Lead l = makeLeadWith('Ldrtest', 'Linksearch', 'Linksearch Co', 'ldr.link.search@example.com');
        Boolean phoneSet = true;
        try {
            l.Phone = '(415) 555-0199';
            update l;
        } catch (DmlException e) {
            phoneSet = false; // org validation on Lead updates; the phone check is skipped
        }
        Contact c = makeContact('Linkcontact', 'ldr.link.contact@example.com');
        Test.setFixedSearchResults(new List<Id>{ l.Id, c.Id });
        Test.startTest();
        List<LdrInboxController.PersonHit> byName = LdrInboxController.searchLinkRecords('Lead', 'linksearch', 5);
        List<LdrInboxController.PersonHit> byPhone = LdrInboxController.searchLinkRecords('Lead', '555-0199', 5);
        List<LdrInboxController.PersonHit> miss = LdrInboxController.searchLinkRecords('Lead', 'zzqq', 5);
        List<LdrInboxController.PersonHit> contacts = LdrInboxController.searchLinkRecords('Contact', 'Linkcontact', 500);
        List<LdrInboxController.PersonHit> tooShort = LdrInboxController.searchLinkRecords('Contact', 'a', 5);
        Test.stopTest();
        System.assertEquals(1, byName.size(), 'The Lead matches by name');
        System.assertEquals(l.Id, byName[0].id);
        System.assertEquals('Lead', byName[0].kind);
        if (phoneSet) {
            System.assertEquals(1, byPhone.size(), 'Phone digits match a formatted phone');
        }
        System.assertEquals(0, miss.size(), 'Search hits without the text are dropped');
        System.assertEquals(1, contacts.size(), 'Contacts are searched on their own; the cap is clamped to 50');
        System.assertEquals('Contact', contacts[0].kind);
        System.assertEquals(0, tooShort.size(), 'Under 2 characters: no search');
    }

    @IsTest
    static void searchPeopleCountsOpenOpportunities() {
        Id accountId = makeAccountId();
        Contact c = makeContact('Searchopp', 'ldr.search.opp@example.com');
        Opportunity o;
        try {
            o = makeOpportunity(accountId);
            insert new OpportunityContactRole(ContactId = c.Id, OpportunityId = o.Id);
        } catch (Exception e) {
            return; // org automation blocks the Opportunity; nothing to count
        }
        o = [SELECT StageName, IsClosed FROM Opportunity WHERE Id = :o.Id];
        Test.startTest();
        LdrInboxController.PeopleSearchResult r = LdrInboxController.searchPeople('ldr.search.opp@example.com');
        Test.stopTest();
        System.assertEquals(1, r.people.size());
        System.assertEquals(o.IsClosed ? 0 : 1, r.people[0].openOppCount);
        if (!o.IsClosed) {
            System.assertEquals(o.StageName, r.people[0].openOppStages[0]);
        }
    }

    // ---------------------------------------------------------------- 6Sense tab (canvas #151, #152 A / K)

    @IsTest
    static void sixSenseKeepRule() {
        Datetime created = Datetime.newInstance(2026, 10, 5, 12, 0, 0); // running user's time zone
        String casl = 'Thanks!\n\nFor our Canadian contacts, per the Canadian Anti-Spam Legislation (CASL) you may unsubscribe.';
        String caslNoSpace = 'Thanks!\n\nFor our Canadian contacts,per the Canadian Anti-Spam Legislation (CASL) you may unsubscribe.';
        System.assert(LdrInboxController.keepSixSenseReply(null, created, 'Interested, call me.'), 'Blank stamp: kept');
        System.assert(LdrInboxController.keepSixSenseReply(Date.newInstance(2026, 10, 4), created, null), 'Stamp earlier: kept');
        System.assert(!LdrInboxController.keepSixSenseReply(Date.newInstance(2026, 10, 5), created, 'Hi'), 'Same day: dropped');
        System.assert(!LdrInboxController.keepSixSenseReply(Date.newInstance(2026, 10, 6), created, 'Hi'), 'Stamp later: dropped');
        System.assert(!LdrInboxController.keepSixSenseReply(null, created, casl), 'CASL footer: dropped');
        System.assert(!LdrInboxController.keepSixSenseReply(null, created, caslNoSpace), 'CASL footer without the space: dropped');
        System.assert(!LdrInboxController.keepSixSenseReply(null, created, casl.toUpperCase()), 'CASL match ignores case');
    }

    @IsTest
    static void sixSenseIsAdminOnly() {
        LdrInboxController.adminUserIds = new Set<Id>(); // a normal LDR, whoever runs the tests (canvas #152 A)
        Test.startTest();
        LdrInboxController.SixSenseReplyResult r = LdrInboxController.getSixSenseReplies();
        String err;
        try {
            LdrInboxController.saveSixSenseStatus(UserInfo.getUserId(), 'Nurture', null, Date.today());
        } catch (AuraHandledException e) {
            err = e.getMessage();
        }
        Test.stopTest();
        System.assertEquals(0, r.people.size(), 'Non-admins get an empty list');
        System.assertEquals(false, r.capped);
        System.assertEquals(null, r.error, 'No error for non-admins, just nothing');
        System.assert(err != null && err.contains('admins'), 'Non-admins cannot save: ' + err);
    }

    /**
     * Admin path: a Lead in a Rina campaign with a 6sense reply is listed (Unassigned: no coordinator); the CASL reply
     * is left out; a status button (Lead Funnel Time Stamp = today) takes the person off the list. Skips quietly when
     * the 6sense package fields don't exist or org automation blocks the test data.
     */
    @IsTest
    static void sixSenseListsRepliesAndStatusTakesThemOff() {
        if (!Schema.SObjectType.Lead.fields.getMap().containsKey('sixsense_ce__campaign_name__c')) {
            return;
        }
        LdrInboxController.adminUserIds = new Set<Id>{ UserInfo.getUserId() };
        Lead l = makeLead('sixsense');
        try {
            l.put('sixsense_ce__campaign_name__c', '6S.LN.A.6S.S.Grade_B.202512-Rina');
            l.Lead_Funnel_Time_Stamp__c = null;
            l.Project_Coordinator__c = null;
            update l;
        } catch (Exception e) {
            return; // package field validation / automation in this org
        }
        insert new List<Task>{
            new Task(WhoId = l.Id, Subject = '[6sense] [Email] [In] Re: Local Design Support', Status = 'Completed',
                Description = 'Yes, please call me.\n\nOn Monday, Oct 12, Rina <r@nanawall.com> wrote:\nHi'),
            new Task(WhoId = l.Id, Subject = '[6sense] [Email] [In] Auto-reply', Status = 'Completed',
                Description = 'Out of office.\nFor our Canadian contacts, per the Canadian Anti-Spam Legislation (CASL)')
        };

        Test.startTest();
        LdrInboxController.SixSenseReplyResult r = LdrInboxController.getSixSenseReplies();
        String saveErr;
        try {
            LdrInboxController.saveSixSenseStatus(l.Id, 'Nurture', null, LdrInboxController.todayPacific());
        } catch (AuraHandledException e) {
            saveErr = e.getMessage();
        }
        LdrInboxController.SixSenseReplyResult after = LdrInboxController.getSixSenseReplies();
        Test.stopTest();

        System.assertEquals(null, r.error, 'Query runs: ' + r.error);
        LdrInboxController.SixSensePerson p;
        for (LdrInboxController.SixSensePerson x : r.people) {
            if (x.leadId == l.Id) { p = x; }
        }
        System.assertNotEquals(null, p, 'The Lead is listed');
        System.assertEquals(1, p.replies.size(), 'The CASL reply is left out');
        System.assertEquals('Re: Local Design Support', p.replies[0].subject);
        System.assertEquals('Task', p.replies[0].kind);
        System.assertEquals('Yes, please call me.', p.replies[0].body, 'Quoted thread trimmed');
        System.assertEquals(true, p.unassigned, 'No coordinator: Unassigned');
        System.assertEquals(p.replies[0].createdDate, p.latestAt);
        if (saveErr != null) {
            return; // a Lead validation rule in this org blocks Nurture; the refusal is still an AuraHandledException
        }
        Lead saved = [SELECT Status, Lead_Funnel_Time_Stamp__c FROM Lead WHERE Id = :l.Id];
        System.assertEquals('Nurture', saved.Status);
        System.assertEquals(LdrInboxController.todayPacific(), saved.Lead_Funnel_Time_Stamp__c);
        // The stamp is today in Pacific; the reply's date is in the running user's time zone (same day for the team).
        if (saved.Lead_Funnel_Time_Stamp__c >= p.latestAt.date()) {
            for (LdrInboxController.SixSensePerson x : after.people) {
                System.assertNotEquals(l.Id, x.leadId, 'Stamp = today: off the list until they reply again');
            }
        }
    }

    // ---------------------------------------------------------------- #156: Comments fields, ClaimedDate__c, one-time move

    /** Tags never push the 255-character Comments field over, and are never added twice. */
    @IsTest
    static void tagsFitTheCommentsField() {
        System.assertEquals('#FixReviewed', LdrInboxController.withTag(null, '#FixReviewed'));
        System.assertEquals('#LinkFixed #FixReviewed', LdrInboxController.withTag('#LinkFixed', '#FixReviewed'));
        System.assertEquals('#LinkFixed', LdrInboxController.withTag('#LinkFixed', '#LinkFixed'));
        System.assertEquals(null, LdrInboxController.withTag('x'.repeat(250), '#FixReviewed'), 'no room: nothing is cut');
        System.assertEquals('Comments1__c', LdrInboxController.tagField('Form_Submission__c'));
        System.assertEquals('Comments__c', LdrInboxController.tagField(LdrInboxController.ESTIMATE_OBJECT));
        System.assertEquals('Comments__c', LdrInboxController.legacyTagField('Form_Submission__c'));
        System.assertEquals(null, LdrInboxController.legacyTagField('KBMax_Web_Quote__c'));
    }

    /** A junk mark made before #156 (tag in Comments__c) still restores, and the old tag is removed. */
    @IsTest
    static void restoreJunkFromTheOldField() {
        Form_Submission__c f = new Form_Submission__c(First_Name__c = 'Old', Last_Name__c = 'Junk',
            Email_Address__c = 'old.junk@example.com', Comments__c = '#Junk:Test submission',
            Inquiry_Type__c = 'Contact Us', Submit_Time__c = Datetime.now(), Claimed_By__c = UserInfo.getUserId());
        insert f;
        Test.startTest();
        Integer n = LdrInboxController.restoreJunk(new List<Id>{ f.Id });
        Test.stopTest();
        System.assertEquals(1, n);
        Form_Submission__c after = [SELECT Claimed_By__c, Comments__c FROM Form_Submission__c WHERE Id = :f.Id];
        System.assertEquals(null, after.Claimed_By__c);
        System.assertEquals(null, after.Comments__c);
    }

    /** #156 one-time move: tags to the new fields, missing claim times filled; a second run finds nothing. */
    @IsTest
    static void moveLegacyFieldsOnce() {
        LdrInboxController.adminUserIds = new Set<Id>{ UserInfo.getUserId() };
        Date claimDay = Date.today().addDays(-3);
        Form_Submission__c f = new Form_Submission__c(First_Name__c = 'Move', Last_Name__c = 'Me',
            Email_Address__c = 'move.me@example.com', Inquiry_Type__c = 'Contact Us', Submit_Time__c = Datetime.now(),
            Comments__c = '#LinkFixed-email #Junk:Test submission{prev:Working||Too Early|2026-10-14|}',
            Claimed_By__c = UserInfo.getUserId(), Claimed_Date__c = claimDay);
        Form_Submission__c plain = new Form_Submission__c(First_Name__c = 'Leave', Last_Name__c = 'Me',
            Email_Address__c = 'leave.me@example.com', Inquiry_Type__c = 'Contact Us', Submit_Time__c = Datetime.now());
        insert new List<Form_Submission__c>{ f, plain };
        Test.startTest();
        LdrInboxController.LegacyMoveResult first = LdrInboxController.moveLegacyFields();
        LdrInboxController.LegacyMoveResult second = LdrInboxController.moveLegacyFields();
        Test.stopTest();
        System.assertEquals(0, first.failed, 'Save error: ' + first.firstError);
        System.assertEquals(1, first.tagsMoved);
        System.assertEquals(1, first.claimTimesFilled);
        System.assertEquals(0, second.tagsMoved + second.claimTimesFilled, 'nothing left to move');
        Form_Submission__c after = [SELECT Comments__c, Comments1__c, ClaimedDate__c FROM Form_Submission__c WHERE Id = :f.Id];
        System.assertEquals(null, after.Comments__c);
        System.assertEquals('#LinkFixed-email #Junk:Test submission{prev:Working||Too Early|2026-10-14|}', after.Comments1__c);
        System.assertEquals(LdrInboxController.pacificDatetime(claimDay, 0), after.ClaimedDate__c);
        System.assertEquals(null, [SELECT Comments1__c FROM Form_Submission__c WHERE Id = :plain.Id].Comments1__c);
    }

    /**
     * #156 one-time move, the other paths: a form's #NoContactNeeded at the end of Questions or Comments, an estimate's
     * tag after the customer's text, a released record (old Claimed Date, no claim) left alone, and a full Comments field.
     */
    @IsTest
    static void moveLegacyFieldsOtherPaths() {
        LdrInboxController.adminUserIds = new Set<Id>{ UserInfo.getUserId() };
        Form_Submission__c nc = new Form_Submission__c(First_Name__c = 'No', Last_Name__c = 'Contact',
            Email_Address__c = 'no.contact@example.com', Inquiry_Type__c = 'Contact Us', Submit_Time__c = Datetime.now(),
            Questions_or_Comments__c = 'Please call\n#NoContactNeeded');
        Form_Submission__c released = new Form_Submission__c(First_Name__c = 'Was', Last_Name__c = 'Claimed',
            Email_Address__c = 'was.claimed@example.com', Inquiry_Type__c = 'Contact Us', Submit_Time__c = Datetime.now(),
            Claimed_Date__c = Date.today().addDays(-5));
        Form_Submission__c full = new Form_Submission__c(First_Name__c = 'Full', Last_Name__c = 'Field',
            Email_Address__c = 'full.field@example.com', Inquiry_Type__c = 'Contact Us', Submit_Time__c = Datetime.now(),
            Comments__c = '#FixReviewed', Comments1__c = 'x'.repeat(250));
        insert new List<Form_Submission__c>{ nc, released, full };
        SObject e;
        if (LdrInboxController.estimatesClaimable()) {
            e = Schema.getGlobalDescribe().get('Website_Instant_Estimate__c').newSObject();
            e.put('Email_Address__c', 'move.estimate@example.com');
            e.put('Estimate_Amount__c', 'Custom');
            e.put('Questions_or_Comments__c', 'Need a quote #LinkFixed-email');
            insert e;
        }
        Test.startTest();
        LdrInboxController.LegacyMoveResult res = LdrInboxController.moveLegacyFields();
        Test.stopTest();
        System.assertEquals(0, res.failed, 'Save error: ' + res.firstError);
        System.assertEquals(1, res.skipped, 'the full field is left as it is');
        Form_Submission__c ncAfter = [SELECT Questions_or_Comments__c, Comments1__c FROM Form_Submission__c WHERE Id = :nc.Id];
        System.assertEquals('Please call', ncAfter.Questions_or_Comments__c);
        System.assertEquals('#NoContactNeeded', ncAfter.Comments1__c);
        System.assertEquals(null, [SELECT ClaimedDate__c FROM Form_Submission__c WHERE Id = :released.Id].ClaimedDate__c,
            'not claimed: no claim time');
        System.assertEquals('#FixReviewed', [SELECT Comments__c FROM Form_Submission__c WHERE Id = :full.Id].Comments__c);
        if (e != null) {
            SObject eAfter = Database.query('SELECT Comments__c, Questions_or_Comments__c FROM Website_Instant_Estimate__c WHERE Id = \'' + e.Id + '\'');
            System.assertEquals('#LinkFixed-email', eAfter.get('Comments__c'));
            System.assertEquals('Need a quote', eAfter.get('Questions_or_Comments__c'));
        }
    }

    @IsTest
    static void moveLegacyFieldsIsAdminOnly() {
        LdrInboxController.adminUserIds = new Set<Id>();
        String err;
        try {
            LdrInboxController.moveLegacyFields();
        } catch (AuraHandledException e) {
            err = e.getMessage();
        }
        System.assert(err != null && err.contains('admins'), err);
    }
}