# ⚡ Codebase Quick Reference Card Generation Prompt

## 🎯 Purpose
Analyze existing codebase and create ultra-condensed, scannable reference materials based on actual implementations. Extract the most frequently used patterns, functions, and commands from real code to create instantly useful quick reference cards.

---

## 📋 Codebase Quick Reference Framework

### **Codebase Analysis Request Template**

```
STRICT REQUIREMENT: Analyze ONLY the code and implementations present in the provided codebase. Create quick reference documentation based solely on existing functionality. Make NO assumptions about intended features or undocumented behavior.

Create a comprehensive "Codebase Quick Reference Card" by analyzing [CODEBASE/MODULE/API]. This should be an ultra-condensed, scannable reference that developers can quickly consult while working with this specific codebase.

**Codebase Analysis Context:**
- Code Source: [SPECIFIC_FILES_DIRECTORIES_OR_ENTIRE_CODEBASE]
- Usage Patterns: [EXTRACT_MOST_FREQUENTLY_USED_FUNCTIONS_PATTERNS]
- Target Audience: [DEVELOPERS_WORKING_WITH_THIS_CODEBASE]
- Reference Type: [API_REFERENCE/PATTERN_GUIDE/COMMAND_REFERENCE]

**Content Focus:**
- Most frequently implemented patterns and functions
- Critical syntax and configuration from actual code
- Common debugging approaches found in error handling
- Essential setup steps from build/config files

**Analysis Scope**: [SINGLE_MODULE/API_LAYER/ENTIRE_CODEBASE/SPECIFIC_FEATURE]

Structure using the Codebase Quick Reference methodology below:
```

---

## 📚 **Codebase Quick Reference Structure**

### **⚡ 1. Codebase Essential Commands (30 seconds scan)**
**The most frequently used functions and patterns discovered**

```
Most Common Implementations Found:
┌─────────────────────────────────────────────────────────┐
│ FUNCTION/PATTERN          │ PURPOSE (from code)         │
├─────────────────────────────────────────────────────────┤
│ [function_name(args)]     │ [actual_purpose_from_code]  │
│ [class_pattern()]         │ [actual_purpose_from_code]  │
│ [config_setting]          │ [actual_purpose_from_code]  │
│ [api_endpoint()]          │ [actual_purpose_from_code]  │
│ [util_function()]         │ [actual_purpose_from_code]  │
└─────────────────────────────────────────────────────────┘

Discovered Code Patterns:
  File: [FILENAME] - Lines [X-Y]
  Usage: [HOW_ITS_ACTUALLY_USED_IN_CODEBASE]
  
  File: [FILENAME] - Lines [X-Y]  
  Usage: [HOW_ITS_ACTUALLY_USED_IN_CODEBASE]

Quick Access Locations:
├─ Core Functions: [PRIMARY_MODULE_FILE]
├─ Configuration: [CONFIG_FILE_LOCATIONS]
├─ Utilities: [HELPER_FUNCTION_FILES]
├─ Constants: [CONSTANT_DEFINITIONS_FILE]
└─ Entry Points: [MAIN_EXECUTION_FILES]
```

### **🔧 2. Implementation Syntax Patterns (60 seconds scan)**
**Templates extracted from actual codebase implementations**

```
Discovered Implementation Patterns:

Basic Operations (found in [FILES]):
├─ Create:    [actual_create_pattern_from_code]
├─ Read:      [actual_read_pattern_from_code]  
├─ Update:    [actual_update_pattern_from_code]
├─ Delete:    [actual_delete_pattern_from_code]
└─ Query:     [actual_query_pattern_from_code]

Advanced Patterns (found in [FILES]):
├─ Validation:    [actual_validation_pattern]
├─ Error Handle:  [actual_error_handling_pattern]
├─ Async Ops:     [actual_async_pattern]
├─ Data Transform:[actual_transformation_pattern]
└─ Cache Access:  [actual_caching_pattern]

API Patterns (from [ENDPOINT_FILES]):
├─ GET:       [actual_get_endpoint_pattern]
├─ POST:      [actual_post_endpoint_pattern]
├─ PUT:       [actual_put_endpoint_pattern]
├─ DELETE:    [actual_delete_endpoint_pattern]
└─ Auth:      [actual_authentication_pattern]
```

### **🎯 3. Real Implementation Examples (90 seconds scan)**
**Copy-paste ready solutions from the actual codebase**

```
Production Code Examples:

Core Workflow (from [FILE:LINES]):
# [ACTUAL_COMMENT_FROM_CODE]
[EXACT_CODE_SNIPPET_FROM_CODEBASE]

Error Handling (from [FILE:LINES]):
# [ACTUAL_COMMENT_FROM_CODE]
[EXACT_ERROR_HANDLING_CODE]

Configuration Setup (from [CONFIG_FILE]):
# [ACTUAL_CONFIG_PATTERN]
[EXACT_CONFIGURATION_CODE]

Database Operations (from [FILE:LINES]):
# [ACTUAL_COMMENT_FROM_CODE]
[EXACT_DATABASE_CODE]

Common Utilities (from [UTILS_FILE]):
# Most frequently called helper functions
[ACTUAL_UTILITY_FUNCTIONS]

Integration Examples (from [INTEGRATION_FILES]):
# How external services are actually called
[ACTUAL_INTEGRATION_CODE]
```

### **🚨 4. Actual Error Patterns & Solutions (60 seconds scan)**
**Solutions based on error handling found in the codebase**

```
Error Patterns Found in Code:
┌─────────────────────────────────────────────────────────┐
│ ERROR PATTERN (from code)     │ SOLUTION (from code)    │
├─────────────────────────────────────────────────────────┤
│ [actual_error_type]          │ [actual_handling_code]  │
│ [validation_failure_pattern] │ [actual_validation_fix] │
│ [connection_error_pattern]   │ [actual_retry_logic]    │
│ [timeout_pattern]            │ [actual_timeout_handle] │
│ [auth_failure_pattern]       │ [actual_auth_recovery]  │
└─────────────────────────────────────────────────────────┘

Debug Strategies (from actual code):
• Logging pattern found: [ACTUAL_LOGGING_IMPLEMENTATION]
• Error reporting: [ACTUAL_ERROR_REPORTING_CODE]  
• Health checks: [ACTUAL_HEALTH_CHECK_CODE]
• Monitoring: [ACTUAL_MONITORING_IMPLEMENTATION]

Emergency Procedures (from deployment scripts):
• Stop command: [ACTUAL_STOP_COMMAND_FROM_SCRIPTS]
• Restart command: [ACTUAL_RESTART_COMMAND]
• Status check: [ACTUAL_STATUS_CHECK_COMMAND]
• Log access: [ACTUAL_LOG_ACCESS_COMMAND]
```

### **⚙️ 5. Configuration Essentials (45 seconds scan)**
**Critical settings extracted from actual config files**

```
Production Configuration (from [CONFIG_FILES]):
┌─────────────────────────────────────────────────────────┐
│ SETTING (from config)         │ VALUES (actual)         │
├─────────────────────────────────────────────────────────┤
│ [actual_setting_name]         │ [actual_values_found]   │
│ [env_variable_name]           │ [actual_env_values]     │
│ [database_setting]            │ [actual_db_config]      │
│ [api_setting]                 │ [actual_api_config]     │
│ [security_setting]            │ [actual_security_config]│
└─────────────────────────────────────────────────────────┘

Configuration File Locations (discovered):
• Environment: [ACTUAL_ENV_FILE_PATHS]
• Database: [ACTUAL_DB_CONFIG_PATHS]
• Application: [ACTUAL_APP_CONFIG_PATHS]
• Secrets: [ACTUAL_SECRET_CONFIG_PATHS]
• Build: [ACTUAL_BUILD_CONFIG_PATHS]

Configuration Patterns Found:
[ACTUAL_CONFIGURATION_LOADING_PATTERN]
```

### **🔍 6. Development Commands (30 seconds scan)**
**Commands extracted from package.json, Makefile, scripts, etc.**

```
Build Commands (from [BUILD_FILES]):
├─ Development: [ACTUAL_DEV_COMMAND]
├─ Production: [ACTUAL_BUILD_COMMAND]
├─ Testing: [ACTUAL_TEST_COMMAND]
├─ Linting: [ACTUAL_LINT_COMMAND]
├─ Deployment: [ACTUAL_DEPLOY_COMMAND]
└─ Clean: [ACTUAL_CLEAN_COMMAND]

Database Commands (from [DB_SCRIPTS]):
├─ Migrate: [ACTUAL_MIGRATION_COMMAND]
├─ Seed: [ACTUAL_SEED_COMMAND]
├─ Backup: [ACTUAL_BACKUP_COMMAND]
├─ Restore: [ACTUAL_RESTORE_COMMAND]
└─ Console: [ACTUAL_DB_CONSOLE_COMMAND]

Debug Commands (from [DEBUG_SCRIPTS]):
├─ Logs: [ACTUAL_LOG_COMMAND]
├─ Health: [ACTUAL_HEALTH_COMMAND]  
├─ Performance: [ACTUAL_PERF_COMMAND]
├─ Memory: [ACTUAL_MEMORY_COMMAND]
└─ Network: [ACTUAL_NETWORK_COMMAND]
```

### **📊 7. Project Structure Map (30 seconds scan)**
**Directory layout and file organization discovered**

```
Codebase Architecture (analyzed):
├─ [MAIN_DIRECTORY]/
│   ├─ [CORE_MODULE]/           # [PURPOSE_FROM_CODE_ANALYSIS]
│   │   ├─ [KEY_FILE_1]         # [FUNCTIONALITY_IDENTIFIED]
│   │   └─ [KEY_FILE_2]         # [FUNCTIONALITY_IDENTIFIED]
│   ├─ [UTILITY_MODULE]/        # [PURPOSE_FROM_CODE_ANALYSIS]
│   ├─ [CONFIG_MODULE]/         # [PURPOSE_FROM_CODE_ANALYSIS]
│   └─ [TEST_MODULE]/           # [PURPOSE_FROM_CODE_ANALYSIS]

Entry Points Discovered:
├─ Main Application: [MAIN_FILE_PATH]
├─ API Server: [API_ENTRY_POINT]
├─ Background Jobs: [WORKER_ENTRY_POINT]
├─ Database Scripts: [DB_SCRIPT_LOCATION]
└─ Testing: [TEST_RUNNER_LOCATION]

Import Patterns Found:
[MOST_COMMON_IMPORT_PATTERNS_FROM_CODE]
```

---

## 🎨 **Codebase Analysis Principles**

### **Evidence-Based Content:**
```
✅ Include in Quick Reference:
├─ Functions/classes used in 3+ files
├─ Configuration values found in config files
├─ Commands found in scripts/package.json
├─ Error patterns with implemented handlers
├─ API endpoints with actual implementations
└─ Utility functions called frequently

❌ Exclude from Quick Reference:
├─ Commented-out or experimental code
├─ TODO items or unimplemented features
├─ Debug code or temporary implementations
├─ External library internals
└─ Hypothetical or planned functionality
```

### **Frequency-Based Priority:**
```
Priority Algorithm:
1. Count occurrences of patterns across codebase
2. Identify most commonly used functions/classes
3. Extract most frequently accessed configuration
4. Find most common error handling approaches
5. Document most used development commands

High Priority Indicators:
├─ Used in >5 files: ESSENTIAL
├─ Used in 3-5 files: IMPORTANT  
├─ Used in 2 files: USEFUL
├─ Used in 1 file: CONSIDER
└─ Not used: EXCLUDE
```

### **Practical Utility Focus:**
```
Quick Reference Must Enable:
├─ Copy-paste of common code patterns
├─ Quick lookup of configuration options
├─ Fast reference to build/deploy commands
├─ Instant access to debug procedures
├─ Rapid understanding of project structure
└─ Immediate recognition of error patterns
```

---

## 🔧 **Automated Analysis Techniques**

### **Code Pattern Extraction:**
```
Analysis Methods:
├─ Function call frequency analysis
├─ Import statement consolidation
├─ Configuration file parsing
├─ Comment and docstring extraction
├─ Error handling pattern identification
└─ Test case pattern analysis

Tools and Approaches:
├─ AST parsing for function discovery
├─ Regex patterns for common structures
├─ File system analysis for organization
├─ Git history for usage patterns
└─ Build script parsing for commands
```

### **Usage Pattern Detection:**
```
Pattern Categories:
├─ Initialization patterns (setup code)
├─ Processing patterns (core business logic)
├─ Integration patterns (external API calls)
├─ Persistence patterns (database operations)
├─ Validation patterns (input checking)
└─ Error handling patterns (exception management)

Evidence Sources:
├─ Function definitions and signatures
├─ Class methods and properties
├─ Configuration files and environment variables
├─ Test files and example usage
├─ Documentation and inline comments
└─ Build scripts and deployment configurations
```

---

## ✅ **Codebase Quick Reference Quality Checklist**

### **Accuracy Verification:**
- [ ] All code examples are exact copies from codebase
- [ ] Commands work in the actual development environment
- [ ] Configuration values match actual config files
- [ ] File paths and locations are accurate
- [ ] Function signatures match actual implementations

### **Completeness Assessment:**
- [ ] Most frequently used patterns are documented
- [ ] All major configuration options are included
- [ ] Essential development commands are covered
- [ ] Common error scenarios are addressed
- [ ] Project structure is accurately represented

### **Usability Validation:**
- [ ] Information can be found in under 10 seconds
- [ ] Code examples are copy-paste ready
- [ ] Commands work without modification
- [ ] Reference covers 80% of daily development tasks
- [ ] Format works well in both digital and print

---

## 🎯 **Example Usage**

```
STRICT REQUIREMENT: Analyze ONLY the code and implementations present in the provided codebase. Create quick reference documentation based solely on existing functionality. Make NO assumptions about intended features or undocumented behavior.

Create a comprehensive "Codebase Quick Reference Card" by analyzing the e-commerce API codebase. This should be an ultra-condensed, scannable reference that developers can quickly consult while working with this specific codebase.

**Codebase Analysis Context:**
- Code Source: /src/api/ directory, /config/ files, package.json, and documentation
- Usage Patterns: Extract most frequently used API endpoints, database operations, and utility functions
- Target Audience: Backend developers working on the e-commerce platform
- Reference Type: API reference with configuration and debugging guide

**Content Focus:**
- Most frequently implemented API endpoints and their patterns
- Critical database query patterns and configuration from actual code
- Common debugging approaches found in error handling middleware
- Essential setup steps from package.json and config files

**Analysis Scope**: Complete API layer with supporting configuration and utilities

Structure using the Codebase Quick Reference methodology above.
```

---

## 🏆 **Success Indicators**

A successful Codebase Quick Reference should:
- **Eliminate context switching** for common development tasks
- **Speed up onboarding** for new team members
- **Reduce documentation searching time** by 90%
- **Provide instant access** to most-used patterns
- **Serve as definitive source** for project-specific implementations

**The Ultimate Test**: Can a developer complete common tasks using only the quick reference without opening the actual codebase files? If yes, you've created an indispensable development tool.