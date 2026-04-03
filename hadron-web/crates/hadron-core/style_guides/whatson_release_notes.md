# WHATS'ON Release Notes — Consolidated Style Guide

> Compiled from 6 internal Confluence/documentation sources for use as AI prompt context
> in the Hadron Release Notes Generator.

---

## Table of Contents

1. [UI Terminology (Lingo)](#1-ui-terminology-lingo)
2. [Content Rules](#2-content-rules)
3. [Language & Formatting Guidelines](#3-language--formatting-guidelines)
4. [Writing New Features](#4-writing-new-features)
5. [Writing Fixes — Standard Format](#5-writing-fixes--standard-format)
6. [Writing Fixes — Simplified Format (AI-Assisted)](#6-writing-fixes--simplified-format-ai-assisted)
7. [Review Checklist](#7-review-checklist)
8. [Module Labels](#8-module-labels)
9. [Keyword Rules](#9-keyword-rules)
10. [Title Writing Rules](#10-title-writing-rules)
11. [JIRA Filters & Traceability](#11-jira-filters--traceability)
12. [MadCap Flare Import](#12-madcap-flare-import)

---

## 1. UI Terminology (Lingo)

Always use the correct WHATS'ON UI terminology. This applies to release notes, bug descriptions, customer communication, and training.

| UI Element | Correct Term | Notes |
|---|---|---|
| Top bar with File, Edit, etc. | **Menu** | Contains **menu items** or **commands** |
| Icon row below menu | **Toolbar** | Individual items are **toolbar buttons** or just **buttons** |
| Tree node in navigator | **Level** | e.g., "trailer level in the navigator tree"; the small picture is an **icon** |
| Small preview image | **Thumbnail** | |
| Sub-section within editor | **Tab page** or **tab** | |
| Right side of a screen | **Editor** or **workspace** | "Workspace" when the right side is not strictly an editor |
| Left-side hierarchy | **Navigator tree** or **tree** | |
| Labeled section within a form | **Group box** | |
| Action in a menu | **Menu item** or **command** | |

### Dialog vs. Message vs. Window

| Term | Definition |
|---|---|
| **Dialog** | Opens with several options to choose from (modal — blocks other interaction) |
| **Message** | Numbered; 4 types: questions, remarks, warnings, errors. Can be hidden/defaulted in user/group preferences. Modal. |
| **Window** | Everything that is not a dialog or a message |

### Additional Terminology (from Guidelines doc)

| Correct Term | Usage |
|---|---|
| **Editor** | When there are tab pages |
| **Overall attributes** | When there are no tab pages |
| **List** | A list of items |
| **Group box** | Labeled section in a form |
| **Box** | Generic input area |
| **Drop-down menu** | Contains a **drop-down list** which contains **drop-down values** |
| **Navigator tree** | The left-side hierarchy |
| **Commands** | Actions in menus |

---

## 2. Content Rules

> "The release notes are like a manual that we deliver together with the version. It is a very important document and read by many people, so it should be perfect (or almost)."

### Do's

- Use **realistic values** in examples (not "test")
- Write **WHATS'ON** (not WOn, WhatsOn, won)
- Rewrite JIRA story/bug text into **proper English sentences** — never copy raw ticket text
- **Combine related stories** under one title when they concern the same topic
- UI element names (fields, tab pages, modules) start with a **capital on the first word only**
  - e.g., "The tab page **Trailers** in the **Site preferences** of the **Administration** module"
- Be **precise** and **complete** — e.g., mention default values for new check boxes
- Use **active voice**, avoid passive sentences
- Use **consistent bracket style** — either `'Site preferences'` or `site preferences`, not mixed
- Use **bullet lists** when listing 3+ items
- Use **connecting words** (therefore, on the other hand, whereas, unlike, moreover)

### Don'ts

- No abbreviations (tx event, won, RN, etc.)
- No arrows or step notation like `select the tx event >> enter the duration >>`
- No excessive capitals (e.g., ~~Preferred Ingest Date~~ → Preferred ingest date)
- No colons after titles
- No quotes around UI text — use **bold** instead
- Avoid the word "customers" — use **users** or **the administrator**
- Avoid technical terms: ~~level~~, ~~command~~, ~~field~~, ~~value~~ (unless essential)
- Avoid "amend" — use **change** or **modify**
- Avoid "crash" in fix titles when possible
- Do not refer to WHATS'ON by name (all RNs are about WHATS'ON — it's redundant)

---

## 3. Language & Formatting Guidelines

### Text Formatting

| What | Format | Example |
|---|---|---|
| On-screen text (new features) | **Bold** | Click **New** to create a new product |
| On-screen text (deprecated features) | *Italic* | The *Old button* has been removed |
| Emphasis on a word/concept | Underline | |
| Quoted text | Only for someone else's words | |

### Menu References

- Use **"on"** not "in" for menu commands
  - Good: "Click **Duplicate product** on the **File** menu"
  - Bad: "via the command 'open creation point' in the 'tools' menu"

### Language

- Use **present tense** (not conditional) — release notes describe actual features, not planned ones
- Use **British English** unless quoting exact interface text (which uses whatever spelling the app uses)
- Always do a **spell check** before publishing
- "Check box" is **two words**
- Use these styles only: Normal, Heading 1–6, Bullets

### Import-Friendly Tips

- Use the latest Word template
- Limit style variety — be consistent with heading levels
- Avoid punctuation in titles (especially colons)
- Avoid quotes — no need to write `'transmission plan'`

---

## 4. Writing New Features

### Structure

1. **Introduction** — Brief description of the new feature
2. **Detail** — Describe what was added, how it works
3. **Conclusion** — Summarize impact or usage tip (if needed)

### Wording Variety

Vary the introduction phrasing:
- "It is now possible to..."
- "Users can now..."
- "From now on, ..."

### Cross-References

- If referring to a deprecated feature, mention the **new feature first**, then the old one
- Give context by linking to related release notes or knowledge base articles
- Add links from KB and previous release notes when a bug mentions multiple modules/tabs/navigators

---

## 5. Writing Fixes — Standard Format

### Structure

1. **Title** — Always start with "Fix for". Keep concise and descriptive. Include the specific area/feature.
   - Example: "Fix for episode title formulas for episodes with many transmissions"

2. **Issue Description** — Start with "Previously, ..." Describe what was wrong.
   - Include specific scenarios or actions that triggered the issue
   - Mention error messages or system crashes if applicable
   - Provide context with links to KB or previous RNs

3. **Steps to Reproduce** (optional) — Only for complicated scenarios (crashes).
   - Use bullet points or numbered lists
   - Skip for simple fixes (a couple of sentences + screenshot suffice)

4. **Cause of the Issue** — Explain why it was occurring. Technical details if needed.

5. **Solution** — Describe what was done to fix the issue (if applicable).

6. **References** — Ticket number in brackets at the end. e.g., "(MGXPRODUCT-15754)"

---

## 6. Writing Fixes — Simplified Format (AI-Assisted)

> Adopted from release 2025r1 to streamline the process.

### Output Format

A Confluence table with columns:
| Column | Description |
|---|---|
| **Issue key** | JIRA ticket number (MGXPRODUCT ID) |
| **Description** | 1–2 sentence explanation of the fix |
| **Module** | Affected module(s) |
| **Labels** | Keywords for filtering |

### AI Prompt Pipeline

**Step 1: Gather JIRA Issues**
```jql
project = "MGXPRODUCT"
AND type = Bug
AND status IN (Done, Delivered)
AND fixversion = "VERSION_PLACEHOLDER"
AND (labels NOT IN (RN_NN) OR labels IS EMPTY)
```
Export columns: Key, Summary, Description, Release notes description

**Step 2: Summarize**
- If `Release notes description` has content → use it (ignore `Description`)
- If `Release notes description` is empty → use `Description`
- Format: Start with "Previously, ..." → End with "This issue has been fixed in this version."
- Retain key details, don't oversimplify
- Reformulate step-by-step reproduction into logical narrative
- Prioritize **precision and traceability** over brevity

**Step 3: Assign Modules & Keywords**
(See sections 8 and 9 below)

**Step 4: Generate Confluence Table**
- Insert into Confluence "Fixed issues" page
- Wrap in Table Filter Macro for sorting/filtering
- Add anchors (bookmarks) per issue key for JIRA linking

### Review Process

- Verify bugs are truly bugs (not features in disguise — if a bug fix adds new functionality, write it as a feature instead)
- Adjust formatting in descriptions
- Add module/label columns
- Add links from KB and previous release notes
- Before moving to Preview: ask AI to compare its first draft with the reviewed version and learn from differences

---

## 7. Review Checklist

When reviewing release notes, verify each item:

- [ ] **Title** — Concise and searchable?
- [ ] **Label** — Correctly marked as new feature or bug?
- [ ] **Base fix version** — Correctly entered?
- [ ] **Base ticket linked** — Ticket delivered, no open remarks? (JIRA Cloud: link from BOTH sides — it's not automatic)
- [ ] **Keywords** — Entered? Including `UPGRADE` if the feature changes pre-upgrade behavior?
- [ ] **Administration checkbox** — Selected if important for administrators?
- [ ] **WHATS'ON module** — Entered? (not the "Related WHATS'ON module" field!)
- [ ] **Epic grouping** — In the appropriate epic? All features/bugs mentioned within the epic?
- [ ] **Epic sentences** — Features adapted into sentences? (not necessary for Fixed issues)
- [ ] **Reason** — Is the purpose of the new feature clear?
- [ ] **Screenshots** — Use deployed images (check logo, no DEV commands visible)

### Pre-Publish Check

Before publishing, verify no closed tickets are missing a release note link or `RN_NN` label. Use the JIRA filters in section 11.

---

## 8. Module Labels

Official WHATS'ON module labels for categorization:

| Module Description | Label |
|---|---|
| Alternative Scheduling | `alternative_scheduling_module` |
| Aspose | `aspose_module` |
| Transmission Automation Integration | `as_run_log_module` |
| Secondary Events As-Run Log | `as_run_log_secondary_events_module` |
| Strategic Planning & Budget Forecasting | `budget_simulation_module` |
| Bumblebee Reports | `bumblebee_module` |
| Sponsoring & Bumper Autoscheduling | `bumper_autoslotter_module` |
| Business API | `business_api_module` |
| Business Layer | `business_layer_module` |
| Acquisition, Screening & Buying Order Management | `buying_order_module` |
| BXF Automation Integration | `bxf_module` |
| Catch-up Scheduling | `catch_up_module` |
| Cloud | `cloud_module` |
| Commercial Integration | `commercial_integration_module` |
| Commercial Spot Management | `commercial_module` |
| Compliance | `compliance_module` |
| Configurable REST | `configurable_rest_module` |
| Continuity Grid Planning | `continuity_grid_planning_module` |
| Continuity Scheduling | `continuity_module` |
| Contract & Rights Management | `contract_module` |
| Use Multi-runs in Contract | `contract_multiruns_module` |
| Underlying Rights (Contract) | `contract_underlying_rights_module` |
| Music & Copyright Reporting | `copyright_module` |
| WHATS'ON Core | `core_module` |
| Statistics & Analysis | `cost_analysis_module` |
| CSA | `csa_module` |
| Curation Management | `curation_module` |
| Dashboard | `dashboard_module` |
| Advanced Graphics and Dynamic Branding | `dynamic_branding_module` |
| External Workflow Module | `external_workflow_module` |
| Financial Stock Management | `financial_stock_module` |
| Model-Based API | `generic_importer_module` |
| Programme Grid Planning | `grid_planner_module` |
| Business Datasets | `insight_module` |
| Interstitial Integration | `interstitial_integration_module` |
| License | `license_module` |
| Lifeguard | `lifeguard_module` |
| Scheduling | `linear_scheduling_module` |
| Mediator | `mediator_module` |
| Media Asset Management (MM2) | `mm2_module` |
| Multiple Local Currencies | `multi_currency_module` |
| Multi Frame Rate Support | `multi_frame_rate_module` |
| Music Rotation Integration | `music_scheduling_integration_module` |
| Music Clip Management | `music_scheduling_module` |
| Network Synchronization | `network_synchronization_module` |
| On-demand Scheduling | `on_demand_module` |
| Web Connectivity (27Q2) | `online_api_module` |
| SOAP/WEB Service Interface Framework | `open_interface_module` |
| ORAD | `orad_module` |
| Parent-child Channels | `parent_child_channels_module` |
| Power Report Builder | `power_report_module` |
| Product Extract Management | `product_extract_management_module` |
| Program Versions | `product_version_module` |
| Program Guide & EPG | `program_guide_module` |
| Program Management | `program_module` |
| PROMOPLAN | `promoplan_module` |
| Quota Reporting | `quota_reporting_module` |
| Regional Commercial Planning | `regional_spot_module` |
| Reporting & Exporting Engine | `report_module` |
| Rights Out | `rights_out_module` |
| Return on Investment | `roi_module` |
| Running Order | `running_order_module` |
| SGT | `sgt_module` |
| Sports Team Management | `sport_module` |
| Sports Rights Management | `sport_rights_module` |
| Traffic & Material Handling | `traffic_module` |
| Promotion Optimiser | `trailer_auto_slotter_module` |
| Promotion & Interstitial Campaign Management | `trailer_module` |
| Encoding and Transcoding | `tx_encoding_module` |
| On-demand Publishing | `tx_publishing_module` |
| Scheduling Artist | `tx_auto_slotter_module` |
| Continuity Artist | `schedule_finalization_module` |
| Video Player Integration Framework | `videoplayer_integration_module` |
| Web Connectivity | `web_server_module` |
| Workflow Interstitials | `workflow_interstitial_module` |
| Workflow Media Management | `workflow_mm_module` |
| Workflow Engine | `workflow_module` |
| WHATS'ON Web | `wow_module` |

---

## 9. Keyword Rules

Each release note must have **at least 2 keywords**:

| Keyword Type | Rule | Examples |
|---|---|---|
| **Concept** | Use the **plural name** of the concept | `contracts`, `scheduling`, `transmissions` |
| **Application** | Use the **correct application name** | `contract_navigator`, `copyright_sheet_navigator` |
| **Drop-down/Gadget** | If fix involves these UI elements | `drop-down_lists`, `gadgets` |
| **Upgrade** | If the fix affects the upgrade process | `upgrade` |
| **DESKTOP_WEB_CONNECTOR** | For desktop-to-web connection notes | `DESKTOP_WEB_CONNECTOR` |

### Keyword Don'ts

- Do **NOT** include version-specific labels (e.g., ~~`base2024r3`~~)
- Do **NOT** use incorrect terms (e.g., ~~`copyright_navigator`~~)
- Do **NOT** forget the `UPGRADE` keyword when a feature changes pre-upgrade behavior

---

## 10. Title Writing Rules

### Principles

- Make the title **speak for itself** — not too high-level
- Include **where** something takes place
- Avoid meaningless words: ~~information~~, ~~new~~, ~~the~~, ~~a~~
- Use **natural language** — say what it does
- No punctuation in titles (especially no colons)
- No quotes in titles

### Examples (Bad → Good)

| Bad (too generic/verbose) | Good (descriptive) |
|---|---|
| New command in the options administration | Enforce command configuration in transmission plan |
| Default display mode for hierarchic drop-down lists | Collapse or expand hierarchic drop-down lists by default |
| Linear rights no longer validated on channels only | Contract verification takes platforms and regions into account |
| Notebook layout configuration | Notebook layout of transmission plan |
| Enhancement in the options dialog possibility to apply options | Apply options before saving |
| Site preference to lock transmission subtitling information | Site preference to lock transmission subtitling |
| New lookup table Transmission block layout | Lookup table for transmission block layouts |
| Indicate the logs to be cleared with the clear change log service | Indicate which logs should be automatically cleared |
| Expected run search criteria in the stock browser | Search for expected runs with stock browser |
| Enhancements in the on-demand time line settings dialog | Enhanced settings for opening on-demand time lines |

---

## 11. JIRA Filters & Traceability

### Filter: Closed tickets without a RN linked

```jql
(((issuetype = "Technical task" AND Context = MGXBASE AND status in ("To Be Developed", "To Be Tested By CS", Closed))
OR (project = JOS AND type in ("Base bug"))
OR (project = JOS AND context in MGXBASEBUGS, MGXBASEBUGSCOPY, MGXBASE)
OR (issuetype = "Base Bug" AND status not in (Closed, Resolved) AND project = JOS AND context in (MGXBASEBUGS, MGXBASEBUGSCOPY, MGXBASE) AND issuetype in (Epic, Story, Sub-story, "CS Remark", "Functional Remark"))))
AND (status = Closed AND issueFunction not in hasLinkType("Release Notes") AND createdDate > 2021-02-01)
ORDER BY created DESC, issuetype DESC, priority DESC, Rank ASC
```

### Filter: Closed tickets without RN link AND without RN_NN label

Same as above with added clause:
```
AND (labels not in (RN_NN) OR labels is EMPTY)
```

> To change the period, adjust `createdDate > YYYY-MM-DD`.

### JIRA ↔ Confluence Linking

- **Confluence side**: Add anchor (bookmark) before each Issue key in the table (anchor name = ticket number)
- **JIRA side**: Add web link (More > Link > Web Link) to the Confluence page URL with `#ANCHOR_NAME`
- For JIRA Cloud: links must be added from **both** sides (not automatic)

---

## 12. MadCap Flare Import

### Export from Confluence

1. Navigate to the Fixed Issues Confluence page
2. More options (...) > Export > Word (.docx)
3. Save locally

### Import into Flare

1. Open MadCap Flare > Content Explorer
2. Locate `Content/ReleaseNotes/` folder for the version
3. Project > Import > MS Word Documents
4. Settings:
   - Import to folder: `Content\ReleaseNotes\RN2024` (or appropriate version)
   - Stylesheet: `wOn.css`
   - Click "Discard MS Word styles"
   - Convert inline formatting to CSS styles
   - Auto-set topic title
   - Avoid empty topics threshold: 50 characters
   - Set first row as header row
   - Apply `wOn.css` table stylesheet to all tables

### Post-Import Review

- Check formatting (headings, paragraphs, lists, tables)
- Verify stylesheet application
- Check topic title and filename length
- Apply correct table style, recreate header if needed
- **Remove Module and Keywords columns** (these are Confluence-only filters)

---

## Source Documents

1. **WHATS'ON lingo for release notes** — Customer Services Confluence
2. **Hints for content** — Customer Services Confluence
3. **Checklist when reviewing Base release notes** — Documentation Confluence
4. **Guidelines for Writing Fixes - Base** — Documentation Confluence (Standard + Simplified + Flare Import)
5. **General guidelines** — Documentation Confluence
6. **Guidelines for writing Release Notes** — Documentation (.docx) — language, tense, formatting, terminology
