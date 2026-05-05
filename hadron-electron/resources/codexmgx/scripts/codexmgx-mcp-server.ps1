$ErrorActionPreference = "Stop"

function Get-BasicAuthHeader {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Principal,
        [Parameter(Mandatory = $true)]
        [string]$Secret
    )

    $pair = "{0}:{1}" -f $Principal, $Secret
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($pair)
    $encoded = [Convert]::ToBase64String($bytes)
    return "Basic $encoded"
}

$script:KnowledgeBaseIndexManifestCache = @{}
$script:KnowledgeBaseIndexChunkCache = @{}

function Get-ConfiguredBackends {
    $backends = @()

    if (-not [string]::IsNullOrWhiteSpace($env:JIRA_CLOUD_BASE_URL) -and
        -not [string]::IsNullOrWhiteSpace($env:JIRA_CLOUD_EMAIL) -and
        -not [string]::IsNullOrWhiteSpace($env:JIRA_API_TOKEN)) {
        $backends += [pscustomobject]@{
            Name = "cloud"
            Product = "jira"
            DisplayName = "Jira Cloud"
            BaseUrl = $env:JIRA_CLOUD_BASE_URL.TrimEnd("/")
            ApiVersion = "3"
            Principal = $env:JIRA_CLOUD_EMAIL
            Secret = $env:JIRA_API_TOKEN
        }
    }

    $confluenceBaseUrl = if (-not [string]::IsNullOrWhiteSpace($env:CONFLUENCE_CLOUD_BASE_URL)) {
        $env:CONFLUENCE_CLOUD_BASE_URL
    }
    elseif (-not [string]::IsNullOrWhiteSpace($env:JIRA_CLOUD_BASE_URL)) {
        $env:JIRA_CLOUD_BASE_URL
    }
    else {
        $null
    }

    $confluencePrincipal = if (-not [string]::IsNullOrWhiteSpace($env:CONFLUENCE_CLOUD_EMAIL)) {
        $env:CONFLUENCE_CLOUD_EMAIL
    }
    elseif (-not [string]::IsNullOrWhiteSpace($env:JIRA_CLOUD_EMAIL)) {
        $env:JIRA_CLOUD_EMAIL
    }
    else {
        $null
    }

    $confluenceSecret = if (-not [string]::IsNullOrWhiteSpace($env:CONFLUENCE_CLOUD_API_TOKEN)) {
        $env:CONFLUENCE_CLOUD_API_TOKEN
    }
    elseif (-not [string]::IsNullOrWhiteSpace($env:JIRA_API_TOKEN)) {
        $env:JIRA_API_TOKEN
    }
    else {
        $null
    }

    if (-not [string]::IsNullOrWhiteSpace($confluenceBaseUrl) -and
        -not [string]::IsNullOrWhiteSpace($confluencePrincipal) -and
        -not [string]::IsNullOrWhiteSpace($confluenceSecret)) {
        $backends += [pscustomobject]@{
            Name = "confluence"
            Product = "confluence"
            DisplayName = "Confluence Cloud"
            BaseUrl = $confluenceBaseUrl.TrimEnd("/")
            Principal = $confluencePrincipal
            Secret = $confluenceSecret
        }
    }

    $knowledgeBaseUrl = if (-not [string]::IsNullOrWhiteSpace($env:WHATSON_KB_BASE_URL)) {
        $env:WHATSON_KB_BASE_URL
    }
    else {
        "https://whatsonknowledgebase.mediagenix.tv/latest_version/"
    }

    if (-not [string]::IsNullOrWhiteSpace($knowledgeBaseUrl)) {
        $backends += [pscustomobject]@{
            Name = "knowledgebase"
            Product = "knowledgebase"
            DisplayName = "WHATS'ON Knowledge Base"
            BaseUrl = $knowledgeBaseUrl.TrimEnd("/")
        }
    }

    return $backends
}

function Get-RequestedBackends {
    param(
        [Parameter(Mandatory = $true)]
        [ValidateSet("jira", "confluence", "knowledgebase")]
        [string]$Product,
        [Parameter()]
        [string]$Source = ""
    )

    $configured = Get-ConfiguredBackends | Where-Object { $_.Product -eq $Product }
    if ($configured.Count -eq 0) {
        throw "No configured $Product sources were found. Update your local codexmgx-env.ps1 file or set the required environment variables."
    }

    $normalizedSource = if ([string]::IsNullOrWhiteSpace($Source)) { "auto" } else { $Source.Trim().ToLowerInvariant() }

    if ($Product -eq "confluence") {
        switch ($normalizedSource) {
            "auto" { return $configured | Select-Object -First 1 }
            "cloud" { return $configured | Select-Object -First 1 }
            "confluence" { return $configured | Select-Object -First 1 }
            default { throw "Unsupported Confluence source '$Source'. Use 'auto', 'cloud', or 'confluence'." }
        }
    }

    if ($Product -eq "knowledgebase") {
        switch ($normalizedSource) {
            "auto" { return $configured | Select-Object -First 1 }
            "knowledgebase" { return $configured | Select-Object -First 1 }
            default { throw "Unsupported knowledge base source '$Source'. Use 'auto' or 'knowledgebase'." }
        }
    }

    switch ($normalizedSource) {
        "auto" { return $configured | Select-Object -First 1 }
        "cloud" { return $configured | Where-Object { $_.Name -eq "cloud" } }
        default { throw "Unsupported Jira source '$Source'. Use 'auto' or 'cloud'." }
    }
}

function Invoke-BackendApi {
    param(
        [Parameter(Mandatory = $true)]
        $Backend,
        [Parameter(Mandatory = $true)]
        [ValidateSet("GET", "POST")]
        [string]$Method,
        [Parameter(Mandatory = $true)]
        [string]$Path,
        [Parameter()]
        $Body
    )

    $headers = @{
        Authorization = (Get-BasicAuthHeader -Principal $Backend.Principal -Secret $Backend.Secret)
        Accept = "application/json"
    }

    $uri = "{0}{1}" -f $Backend.BaseUrl, $Path
    $params = @{
        Method = $Method
        Uri = $uri
        Headers = $headers
        ContentType = "application/json"
    }

    if ($null -ne $Body) {
        $params.Body = ($Body | ConvertTo-Json -Depth 20)
    }

    try {
        return Invoke-RestMethod @params
    }
    catch {
        $message = $_.Exception.Message
        if ($_.ErrorDetails -and $_.ErrorDetails.Message) {
            $message = $_.ErrorDetails.Message
        }

        throw "$($Backend.DisplayName) API request failed for $Method $Path. $message"
    }
}

function Format-JiraIssueSummaryLine {
    param(
        [Parameter(Mandatory = $true)]
        $Issue,
        [Parameter(Mandatory = $true)]
        [string]$SourceLabel
    )

    $fields = $Issue.fields
    $status = if ($fields.status) { $fields.status.name } else { "Unknown" }
    $assignee = if ($fields.assignee) { $fields.assignee.displayName } else { "Unassigned" }
    $summary = if ($fields.summary) { $fields.summary } else { "" }
    return "[{0}] {1} [{2}] {3} (assignee: {4})" -f $SourceLabel, $Issue.key, $status, $summary, $assignee
}

function Get-ConfluenceBrowserBaseUrl {
    param(
        [Parameter(Mandatory = $true)]
        [string]$BaseUrl
    )

    $trimmed = $BaseUrl.TrimEnd("/")
    if ($trimmed.EndsWith("/wiki", [System.StringComparison]::OrdinalIgnoreCase)) {
        return $trimmed
    }

    return "$trimmed/wiki"
}

function Join-ConfluenceWebUrl {
    param(
        [Parameter(Mandatory = $true)]
        [string]$BaseUrl,
        [Parameter()]
        [string]$RelativeUrl
    )

    if ([string]::IsNullOrWhiteSpace($RelativeUrl)) {
        return ""
    }

    if ($RelativeUrl -match "^https?://") {
        return $RelativeUrl
    }

    $trimmedBase = $BaseUrl.TrimEnd("/")
    if ($RelativeUrl.StartsWith("/wiki/", [System.StringComparison]::OrdinalIgnoreCase)) {
        return "{0}{1}" -f $trimmedBase, $RelativeUrl
    }

    $browserBase = Get-ConfluenceBrowserBaseUrl -BaseUrl $BaseUrl
    if ($RelativeUrl.StartsWith("/")) {
        return "{0}{1}" -f $browserBase, $RelativeUrl
    }

    return "{0}/{1}" -f $browserBase, $RelativeUrl
}

function Format-ConfluenceSearchLine {
    param(
        [Parameter(Mandatory = $true)]
        $Result,
        [Parameter(Mandatory = $true)]
        [string]$BaseUrl
    )

    $content = $Result.content
    $title = if ($content -and $content.title) { $content.title } elseif ($Result.title) { $Result.title } else { "(untitled)" }
    $contentType = if ($content -and $content.type) { $content.type } elseif ($Result.entityType) { $Result.entityType } else { "content" }
    $spaceKey = if ($Result.space -and $Result.space.key) { $Result.space.key } elseif ($content -and $content.space -and $content.space.key) { $content.space.key } else { "" }
    $relativeUrl = if ($Result.url) { $Result.url } elseif ($content -and $content._links -and $content._links.webui) { $content._links.webui } else { "" }
    $fullUrl = Join-ConfluenceWebUrl -BaseUrl $BaseUrl -RelativeUrl $relativeUrl
    $prefix = if ([string]::IsNullOrWhiteSpace($spaceKey)) { $contentType } else { "$spaceKey / $contentType" }

    if ([string]::IsNullOrWhiteSpace($fullUrl)) {
        return "[Confluence] {0} - {1}" -f $prefix, $title
    }

    return "[Confluence] {0} - {1} ({2})" -f $prefix, $title, $fullUrl
}

function Normalize-ConfluenceMarkup {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Value
    )

    $text = $Value -replace "<br\s*/?>", "`n"
    $text = $text -replace "</(p|div|li|tr|h[1-6])>", "`n"
    $text = $text -replace "<li[^>]*>", "- "
    $text = $text -replace "<[^>]+>", " "
    $text = [System.Net.WebUtility]::HtmlDecode($text)
    $text = $text -replace "[ \t]+", " "
    $text = $text -replace "(\r?\n){3,}", "`n`n"
    return $text.Trim()
}

function Get-ConfluenceSearchCql {
    param(
        [string]$Query = "",
        [string]$SpaceKey = "",
        [string]$AncestorId = "",
        [string]$Cql = ""
    )

    if (-not [string]::IsNullOrWhiteSpace($Cql)) {
        return [string]$Cql
    }

    if ([string]::IsNullOrWhiteSpace($Query)) {
        throw "Missing required argument: query or cql"
    }

    $escapedQuery = $Query.Replace("\", "\\").Replace("`"", "\`"")
    $terms = @("text ~ `"$escapedQuery`"")
    if (-not [string]::IsNullOrWhiteSpace($SpaceKey)) {
        $terms += "space = `"$SpaceKey`""
    }
    if (-not [string]::IsNullOrWhiteSpace($AncestorId)) {
        $terms += "ancestor = $AncestorId"
    }

    return [string]::Join(" AND ", $terms)
}

function Find-ConfluenceSearchResultByContentId {
    param(
        [Parameter(Mandatory = $true)]
        $Backend,
        [Parameter(Mandatory = $true)]
        [string]$ContentId
    )

    $cql = "id = $ContentId"
    $path = "/wiki/rest/api/search?limit=1&cql=$([uri]::EscapeDataString($cql))"
    $result = Invoke-BackendApi -Backend $Backend -Method "GET" -Path $path
    return @($result.results) | Select-Object -First 1
}

function Get-ModDocumentationSettings {
    $homepageContentId = if (-not [string]::IsNullOrWhiteSpace($env:MOD_DOCS_HOMEPAGE_ID)) {
        [string]$env:MOD_DOCS_HOMEPAGE_ID
    }
    else {
        "1888060283"
    }

    $spacePath = if (-not [string]::IsNullOrWhiteSpace($env:MOD_DOCS_SPACE_PATH)) {
        [string]$env:MOD_DOCS_SPACE_PATH
    }
    else {
        "modkb"
    }

    return [pscustomobject]@{
        HomepageContentId = $homepageContentId
        SpacePath = $spacePath
    }
}

function Get-ModDocumentationOverviewUrl {
    param(
        [Parameter(Mandatory = $true)]
        $Backend,
        [Parameter(Mandatory = $true)]
        $Settings
    )

    return "{0}/spaces/{1}/overview?homepageId={2}" -f (Get-ConfluenceBrowserBaseUrl -BaseUrl $Backend.BaseUrl), $Settings.SpacePath, $Settings.HomepageContentId
}

function Invoke-PlainGetRequest {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Uri
    )

    try {
        $response = Invoke-WebRequest -Uri $Uri -Method "GET" -TimeoutSec 30 -Headers @{
            Accept = "text/html,application/json,text/plain,*/*"
        }

        return [string]$response.Content
    }
    catch {
        $message = $_.Exception.Message
        if ($_.ErrorDetails -and $_.ErrorDetails.Message) {
            $message = $_.ErrorDetails.Message
        }

        throw "Knowledge base request failed for GET $Uri. $message"
    }
}

function Convert-DefinedModuleToObject {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Content
    )

    $json = $Content.Trim()
    if ($json -notmatch "^\s*define\(") {
        throw "Unexpected knowledge base index format."
    }

    $json = $json -replace "^\s*define\(", ""
    $json = $json -replace "\);\s*$", ""
    $json = $json -replace "([,{])([A-Za-z0-9_]+):", '$1"$2":'
    $json = $json -replace "'", '"'

    return $json | ConvertFrom-Json -Depth 100
}

function Get-KnowledgeBaseIndexManifest {
    param(
        [Parameter(Mandatory = $true)]
        $Backend
    )

    $cacheKey = $Backend.BaseUrl
    if ($script:KnowledgeBaseIndexManifestCache.ContainsKey($cacheKey)) {
        return $script:KnowledgeBaseIndexManifestCache[$cacheKey]
    }

    $manifestUrl = "{0}/Data/Index.js" -f $Backend.BaseUrl
    $manifest = Convert-DefinedModuleToObject -Content (Invoke-PlainGetRequest -Uri $manifestUrl)
    $script:KnowledgeBaseIndexManifestCache[$cacheKey] = $manifest
    return $manifest
}

function Get-KnowledgeBaseIndexChunk {
    param(
        [Parameter(Mandatory = $true)]
        $Backend,
        [Parameter(Mandatory = $true)]
        [int]$ChunkNumber
    )

    $cacheKey = "{0}|{1}" -f $Backend.BaseUrl, $ChunkNumber
    if ($script:KnowledgeBaseIndexChunkCache.ContainsKey($cacheKey)) {
        return $script:KnowledgeBaseIndexChunkCache[$cacheKey]
    }

    $chunkUrl = "{0}/Data/Index_Chunk{1}.js" -f $Backend.BaseUrl, $ChunkNumber
    $chunk = Convert-DefinedModuleToObject -Content (Invoke-PlainGetRequest -Uri $chunkUrl)
    $script:KnowledgeBaseIndexChunkCache[$cacheKey] = $chunk
    return $chunk
}

function Resolve-KnowledgeBaseUrl {
    param(
        [Parameter(Mandatory = $true)]
        $Backend,
        [Parameter(Mandatory = $true)]
        [string]$PageUrlOrPath
    )

    $value = $PageUrlOrPath.Trim()
    if ($value -match "^https?://") {
        return $value
    }

    $trimmed = $value.TrimStart(".")
    if ($trimmed.StartsWith("/")) {
        return "{0}{1}" -f $Backend.BaseUrl, $trimmed
    }

    return "{0}/{1}" -f $Backend.BaseUrl, $trimmed.TrimStart("/")
}

function Get-KnowledgeBaseRelativePath {
    param(
        [Parameter(Mandatory = $true)]
        $Backend,
        [Parameter(Mandatory = $true)]
        [string]$Url
    )

    if ($Url.StartsWith($Backend.BaseUrl, [System.StringComparison]::OrdinalIgnoreCase)) {
        $relative = $Url.Substring($Backend.BaseUrl.Length)
        if (-not $relative.StartsWith("/")) {
            $relative = "/$relative"
        }

        return $relative
    }

    return $Url
}

function Get-HtmlDivInnerContentById {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Html,
        [Parameter(Mandatory = $true)]
        [string]$ElementId
    )

    $patterns = @(
        "id=""$ElementId""",
        "id='$ElementId'"
    )

    $idIndex = -1
    foreach ($pattern in $patterns) {
        $idIndex = $Html.IndexOf($pattern)
        if ($idIndex -ge 0) {
            break
        }
    }

    if ($idIndex -lt 0) {
        return $null
    }

    $startTagIndex = $Html.LastIndexOf("<div", $idIndex)
    if ($startTagIndex -lt 0) {
        return $null
    }

    $relativeHtml = $Html.Substring($startTagIndex)
    $innerStart = $relativeHtml.IndexOf(">") + 1
    if ($innerStart -le 0) {
        return $null
    }

    $tokens = [regex]::Matches($relativeHtml, "(?is)<div\b[^>]*>|</div>")
    $depth = 0
    foreach ($token in $tokens) {
        if ($token.Value -match "^<div\b" -and $token.Value -notmatch "/>$") {
            $depth += 1
            continue
        }

        if ($token.Value -match "^</div") {
            $depth -= 1
            if ($depth -eq 0) {
                return $relativeHtml.Substring($innerStart, $token.Index - $innerStart)
            }
        }
    }

    return $null
}

function Get-HtmlTitle {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Html
    )

    $match = [regex]::Match($Html, "(?is)<title>\s*(.*?)\s*</title>")
    if (-not $match.Success) {
        return ""
    }

    return [System.Net.WebUtility]::HtmlDecode($match.Groups[1].Value.Trim())
}

function Normalize-KnowledgeBaseMarkup {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Html
    )

    $body = Get-HtmlDivInnerContentById -Html $Html -ElementId "mc-main-content"
    if ([string]::IsNullOrWhiteSpace($body)) {
        $body = $Html
    }

    $text = $body -replace "(?is)<script\b[^>]*>.*?</script>", " "
    $text = $text -replace "(?is)<style\b[^>]*>.*?</style>", " "
    $text = $text -replace "(?is)<!--.*?-->", " "
    $text = $text -replace "(?i)<br\s*/?>", "`n"
    $text = $text -replace "(?i)</(p|div|li|tr|h[1-6]|section|article|ul|ol|table)>", "`n"
    $text = $text -replace "(?i)<li[^>]*>", "- "
    $text = $text -replace "(?is)<[^>]+>", " "
    $text = [System.Net.WebUtility]::HtmlDecode($text)
    $text = $text -replace "[ \t]+", " "
    $text = $text -replace " *`r?`n *", "`n"
    $text = $text -replace "(\r?\n){3,}", "`n`n"
    return $text.Trim()
}

function Add-KnowledgeBaseIndexLinks {
    param(
        [Parameter(Mandatory = $true)]
        $Node,
        [Parameter(Mandatory = $true)]
        [string]$TermPath,
        [Parameter(Mandatory = $true)]
        [AllowEmptyCollection()]
        [System.Collections.Generic.List[object]]$Results
    )

    if ($null -eq $Node) {
        return
    }

    if ($Node.l) {
        foreach ($link in @($Node.l)) {
            if (-not [string]::IsNullOrWhiteSpace($link.u) -and -not [string]::IsNullOrWhiteSpace($link.t)) {
                $Results.Add([pscustomobject]@{
                    termPath = $TermPath
                    path = [string]$link.u
                    title = [string]$link.t
                })
            }
        }
    }

    if ($Node.e) {
        foreach ($entry in $Node.e.PSObject.Properties) {
            $childTermPath = if ([string]::IsNullOrWhiteSpace($TermPath)) {
                $entry.Name
            }
            else {
                "{0} > {1}" -f $TermPath, $entry.Name
            }

            Add-KnowledgeBaseIndexLinks -Node $entry.Value -TermPath $childTermPath -Results $Results
        }
    }
}

function Invoke-JiraSearchIssuesOnBackend {
    param(
        [Parameter(Mandatory = $true)]
        $Backend,
        [Parameter(Mandatory = $true)]
        [string]$Jql,
        [Parameter(Mandatory = $true)]
        [int]$MaxResults,
        [Parameter(Mandatory = $true)]
        [string[]]$Fields
    )

    $fieldsValue = [string]::Join(",", $Fields)
    $path = "/rest/api/3/search/jql?maxResults=$MaxResults&fields=$([uri]::EscapeDataString($fieldsValue))&jql=$([uri]::EscapeDataString($Jql))"
    return Invoke-BackendApi -Backend $Backend -Method "GET" -Path $path
}

function Invoke-JiraGetIssueOnBackend {
    param(
        [Parameter(Mandatory = $true)]
        $Backend,
        [Parameter(Mandatory = $true)]
        [string]$IssueKey,
        [Parameter(Mandatory = $true)]
        [string[]]$Fields
    )

    $fieldsValue = [string]::Join(",", $Fields)
    $path = "/rest/api/3/issue/${IssueKey}?fields=$([uri]::EscapeDataString($fieldsValue))"
    return Invoke-BackendApi -Backend $Backend -Method "GET" -Path $path
}

function Invoke-JiraListProjectsOnBackend {
    param(
        [Parameter(Mandatory = $true)]
        $Backend,
        [Parameter(Mandatory = $true)]
        [int]$MaxResults
    )

    return Invoke-BackendApi -Backend $Backend -Method "GET" -Path "/rest/api/3/project/search?maxResults=$MaxResults"
}

function Invoke-JiraGetMyselfOnBackend {
    param(
        [Parameter(Mandatory = $true)]
        $Backend
    )

    return Invoke-BackendApi -Backend $Backend -Method "GET" -Path "/rest/api/3/myself"
}

function Invoke-JiraSearchIssues {
    param($Arguments)

    $source = if ($Arguments.source) { [string]$Arguments.source } else { "auto" }
    $jql = if ($Arguments.jql) { [string]$Arguments.jql } else { "assignee = currentUser() ORDER BY updated DESC" }
    $maxResults = if ($Arguments.maxResults) { [int]$Arguments.maxResults } else { 10 }
    $fields = if ($Arguments.fields) { @($Arguments.fields) } else { @("summary", "status", "assignee", "priority", "updated", "issuetype", "project") }

    $backends = @(Get-RequestedBackends -Product "jira" -Source $source)
    if ($backends.Count -eq 0) {
        throw "No Jira backends matched source '$source'."
    }

    $allIssues = @()
    $lines = @()
    foreach ($backend in $backends) {
        $result = Invoke-JiraSearchIssuesOnBackend -Backend $backend -Jql $jql -MaxResults $maxResults -Fields $fields
        $issues = @($result.issues)
        $allIssues += $issues | ForEach-Object {
            [pscustomobject]@{
                source = $backend.Name
                sourceLabel = $backend.DisplayName
                issue = $_
            }
        }

        $lines += "[$($backend.DisplayName)] Found $($issues.Count) issue(s) for JQL: $jql"
        foreach ($issue in $issues) {
            $lines += (Format-JiraIssueSummaryLine -Issue $issue -SourceLabel $backend.DisplayName)
        }
    }

    return @{
        content = @(
            @{
                type = "text"
                text = ($lines -join "`n")
            }
        )
        structuredContent = @{
            sources = $backends | Select-Object Name, DisplayName, Product, BaseUrl
            issues = $allIssues
        }
    }
}

function Invoke-JiraGetIssue {
    param($Arguments)

    if (-not $Arguments.issueKey) {
        throw "Missing required argument: issueKey"
    }

    $source = if ($Arguments.source) { [string]$Arguments.source } else { "auto" }
    $issueKey = [string]$Arguments.issueKey
    $fields = if ($Arguments.fields) { @($Arguments.fields) } else { @("summary", "status", "assignee", "priority", "description", "comment", "updated", "issuetype", "project") }
    $backends = @(Get-RequestedBackends -Product "jira" -Source $source)
    if ($backends.Count -eq 0) {
        throw "No Jira backends matched source '$source'."
    }

    $attempted = @()
    foreach ($backend in $backends) {
        try {
            $result = Invoke-JiraGetIssueOnBackend -Backend $backend -IssueKey $issueKey -Fields $fields
            $fieldsObject = $result.fields
            $status = if ($fieldsObject.status) { $fieldsObject.status.name } else { "Unknown" }
            $summary = if ($fieldsObject.summary) { $fieldsObject.summary } else { "" }
            $assignee = if ($fieldsObject.assignee) { $fieldsObject.assignee.displayName } else { "Unassigned" }

            $text = @(
                "Source: $($backend.DisplayName)"
                "Issue: $($result.key)"
                "Summary: $summary"
                "Status: $status"
                "Assignee: $assignee"
            ) -join "`n"

            return @{
                content = @(
                    @{
                        type = "text"
                        text = $text
                    }
                )
                structuredContent = @{
                    source = $backend | Select-Object Name, DisplayName, Product, BaseUrl
                    issue = $result
                }
            }
        }
        catch {
            $message = $_.Exception.Message
            if ($message -match "Issue does not exist or you do not have permission") {
                $attempted += $backend.DisplayName
                continue
            }

            throw
        }
    }

    throw "Issue $issueKey was not found in the requested Jira sources ($($attempted -join ', '))."
}

function Invoke-JiraListProjects {
    param($Arguments)

    $source = if ($Arguments.source) { [string]$Arguments.source } else { "auto" }
    $maxResults = if ($Arguments.maxResults) { [int]$Arguments.maxResults } else { 50 }
    $backends = @(Get-RequestedBackends -Product "jira" -Source $source)
    if ($backends.Count -eq 0) {
        throw "No Jira backends matched source '$source'."
    }

    $lines = @()
    $allProjects = @()
    foreach ($backend in $backends) {
        $result = Invoke-JiraListProjectsOnBackend -Backend $backend -MaxResults $maxResults
        $projects = @($result.values)
        $lines += "[$($backend.DisplayName)] Found $($projects.Count) project(s)."
        foreach ($project in $projects) {
            $lines += ("[{0}] {1} - {2}" -f $backend.DisplayName, $project.key, $project.name)
        }

        $allProjects += $projects | ForEach-Object {
            [pscustomobject]@{
                source = $backend.Name
                sourceLabel = $backend.DisplayName
                project = $_
            }
        }
    }

    return @{
        content = @(
            @{
                type = "text"
                text = ($lines -join "`n")
            }
        )
        structuredContent = @{
            sources = $backends | Select-Object Name, DisplayName, Product, BaseUrl
            projects = $allProjects
        }
    }
}

function Invoke-JiraGetMyself {
    param($Arguments)

    $source = if ($Arguments.source) { [string]$Arguments.source } else { "auto" }
    $backends = @(Get-RequestedBackends -Product "jira" -Source $source)
    if ($backends.Count -eq 0) {
        throw "No Jira backends matched source '$source'."
    }

    $lines = @()
    $users = @()
    foreach ($backend in $backends) {
        $result = Invoke-JiraGetMyselfOnBackend -Backend $backend
        $email = if ($result.emailAddress) { $result.emailAddress } elseif ($result.name) { $result.name } else { "" }
        $accountId = if ($result.accountId) { $result.accountId } elseif ($result.key) { $result.key } else { "" }

        $lines += @(
            "Source: $($backend.DisplayName)"
            "Logged in as: $($result.displayName)"
            "Email/Login: $email"
            "Account ID: $accountId"
            ""
        )

        $users += [pscustomobject]@{
            source = $backend.Name
            sourceLabel = $backend.DisplayName
            user = $result
        }
    }

    return @{
        content = @(
            @{
                type = "text"
                text = (($lines | Select-Object -SkipLast 1) -join "`n")
            }
        )
        structuredContent = @{
            sources = $backends | Select-Object Name, DisplayName, Product, BaseUrl
            users = $users
        }
    }
}

function Invoke-ConfluenceSearchContent {
    param($Arguments)

    $source = if ($Arguments.source) { [string]$Arguments.source } else { "auto" }
    $query = if ($Arguments.query) { [string]$Arguments.query } else { "" }
    $spaceKey = if ($Arguments.spaceKey) { [string]$Arguments.spaceKey } else { "" }
    $ancestorId = if ($Arguments.ancestorId) { [string]$Arguments.ancestorId } else { "" }
    $limit = if ($Arguments.limit) { [int]$Arguments.limit } else { 10 }
    $cql = Get-ConfluenceSearchCql -Query $query -SpaceKey $spaceKey -AncestorId $ancestorId -Cql $Arguments.cql

    $backend = @(Get-RequestedBackends -Product "confluence" -Source $source) | Select-Object -First 1
    if ($null -eq $backend) {
        throw "No Confluence backend matched source '$source'."
    }

    $path = "/wiki/rest/api/search?limit=$limit&cql=$([uri]::EscapeDataString($cql))"
    $result = Invoke-BackendApi -Backend $backend -Method "GET" -Path $path
    $items = @($result.results)

    $lines = @("[$($backend.DisplayName)] Found $($items.Count) result(s) for CQL: $cql")
    foreach ($item in $items) {
        $lines += (Format-ConfluenceSearchLine -Result $item -BaseUrl $backend.BaseUrl)
    }

    return @{
        content = @(
            @{
                type = "text"
                text = ($lines -join "`n")
            }
        )
        structuredContent = @{
            source = $backend | Select-Object Name, DisplayName, Product, BaseUrl
            cql = $cql
            results = $items
        }
    }
}

function Invoke-ConfluenceGetContent {
    param($Arguments)

    if (-not $Arguments.contentId) {
        throw "Missing required argument: contentId"
    }

    $source = if ($Arguments.source) { [string]$Arguments.source } else { "auto" }
    $contentId = [string]$Arguments.contentId
    $backend = @(Get-RequestedBackends -Product "confluence" -Source $source) | Select-Object -First 1
    if ($null -eq $backend) {
        throw "No Confluence backend matched source '$source'."
    }

    $result = Invoke-BackendApi -Backend $backend -Method "GET" -Path "/wiki/rest/api/content/${contentId}?expand=space,history.lastUpdated,version,body.storage"
    $title = if ($result.title) { $result.title } else { "(untitled)" }
    $contentType = if ($result.type) { [string]$result.type } else { "content" }
    $spaceKey = if ($result.space -and $result.space.key) { $result.space.key } else { "" }
    $updated = if ($result.history -and $result.history.lastUpdated -and $result.history.lastUpdated.when) { $result.history.lastUpdated.when } else { "" }
    $bodyValue = if ($result.body -and $result.body.storage -and $result.body.storage.value) { [string]$result.body.storage.value } else { "" }
    $bodyText = if ([string]::IsNullOrWhiteSpace($bodyValue)) {
        $searchResult = Find-ConfluenceSearchResultByContentId -Backend $backend -ContentId $contentId
        $excerpt = if ($searchResult -and -not [string]::IsNullOrWhiteSpace($searchResult.excerpt)) {
            Normalize-ConfluenceMarkup -Value ([string]$searchResult.excerpt)
        }
        else {
            ""
        }

        if (-not [string]::IsNullOrWhiteSpace($excerpt)) {
            "No body was returned for Confluence type '$contentType'. Search excerpt:`n`n$excerpt"
        }
        else {
            "No body available."
        }
    }
    else {
        Normalize-ConfluenceMarkup -Value $bodyValue
    }
    $relativeUrl = if ($result._links -and $result._links.webui) { $result._links.webui } else { "" }
    $fullUrl = Join-ConfluenceWebUrl -BaseUrl $backend.BaseUrl -RelativeUrl $relativeUrl

    $text = @(
        "Source: $($backend.DisplayName)"
        "Title: $title"
        "Type: $contentType"
        "Space: $spaceKey"
        "Updated: $updated"
        "URL: $fullUrl"
        ""
        $bodyText
    ) -join "`n"

    return @{
        content = @(
            @{
                type = "text"
                text = $text
            }
        )
        structuredContent = @{
            source = $backend | Select-Object Name, DisplayName, Product, BaseUrl
            content = $result
        }
    }
}

function Invoke-ModDocumentationSearch {
    param($Arguments)

    $source = if ($Arguments.source) { [string]$Arguments.source } else { "auto" }
    $query = if ($Arguments.query) { [string]$Arguments.query } else { "" }
    $limit = if ($Arguments.limit) { [int]$Arguments.limit } else { 10 }
    $cql = if ($Arguments.cql) { [string]$Arguments.cql } else { "" }
    $settings = Get-ModDocumentationSettings
    $backend = @(Get-RequestedBackends -Product "confluence" -Source $source) | Select-Object -First 1
    if ($null -eq $backend) {
        throw "No Confluence backend matched source '$source'."
    }

    $resolvedCql = Get-ConfluenceSearchCql -Query $query -AncestorId $settings.HomepageContentId -Cql $cql
    $path = "/wiki/rest/api/search?limit=$limit&cql=$([uri]::EscapeDataString($resolvedCql))"
    $result = Invoke-BackendApi -Backend $backend -Method "GET" -Path $path
    $items = @($result.results)
    $overviewUrl = Get-ModDocumentationOverviewUrl -Backend $backend -Settings $settings

    $lines = @(
        "[MOD Documentation] Found $($items.Count) result(s) for CQL: $resolvedCql"
        "Overview: $overviewUrl"
    )
    foreach ($item in $items) {
        $lines += (Format-ConfluenceSearchLine -Result $item -BaseUrl $backend.BaseUrl)
    }

    return @{
        content = @(
            @{
                type = "text"
                text = ($lines -join "`n")
            }
        )
        structuredContent = @{
            source = $backend | Select-Object Name, DisplayName, Product, BaseUrl
            modDocumentation = @{
                homepageContentId = $settings.HomepageContentId
                overviewUrl = $overviewUrl
            }
            cql = $resolvedCql
            results = $items
        }
    }
}

function Invoke-ModDocumentationGetPage {
    param($Arguments)

    $source = if ($Arguments.source) { [string]$Arguments.source } else { "auto" }
    $settings = Get-ModDocumentationSettings
    $contentId = if ($Arguments.contentId) { [string]$Arguments.contentId } else { $settings.HomepageContentId }
    return Invoke-ConfluenceGetContent -Arguments @{
        source = $source
        contentId = $contentId
    }
}

function Invoke-KnowledgeBaseSearchTopics {
    param($Arguments)

    if (-not $Arguments.query) {
        throw "Missing required argument: query"
    }

    $source = if ($Arguments.source) { [string]$Arguments.source } else { "auto" }
    $query = [string]$Arguments.query
    $maxResults = if ($Arguments.maxResults) { [int]$Arguments.maxResults } else { 10 }
    $backend = @(Get-RequestedBackends -Product "knowledgebase" -Source $source) | Select-Object -First 1
    if ($null -eq $backend) {
        throw "No knowledge base backend matched source '$source'."
    }

    $normalizedQuery = $query.Trim().ToLowerInvariant()
    $queryTerms = @([regex]::Matches($normalizedQuery, "[a-z0-9][a-z0-9'_-]*") | ForEach-Object { $_.Value } | Select-Object -Unique)
    $manifest = Get-KnowledgeBaseIndexManifest -Backend $backend
    $termMatches = New-Object 'System.Collections.Generic.List[object]'

    foreach ($term in @($manifest.terms)) {
        $termText = [string]$term.t
        if ([string]::IsNullOrWhiteSpace($termText)) {
            continue
        }

        $lowerTermText = $termText.ToLowerInvariant()
        $score = 0
        if ($lowerTermText -eq $normalizedQuery) {
            $score = 120
        }
        elseif ($lowerTermText.StartsWith($normalizedQuery)) {
            $score = 100
        }
        elseif ($lowerTermText.Contains($normalizedQuery)) {
            $score = 85
        }
        else {
            $matchingTerms = @($queryTerms | Where-Object { $lowerTermText.Contains($_) })
            if ($matchingTerms.Count -eq 0) {
                continue
            }

            if ($queryTerms.Count -gt 0 -and $matchingTerms.Count -eq $queryTerms.Count) {
                $score = 70 + ($matchingTerms.Count * 3)
            }
            else {
                $score = 35 + ($matchingTerms.Count * 5)
            }
        }

        $termMatches.Add([pscustomobject]@{
            term = $termText
            chunk = [int]$term.c
            score = $score
        })
    }

    $candidateCount = [Math]::Max($maxResults * 3, 15)
    $candidateTerms = $termMatches |
        Sort-Object @{ Expression = "score"; Descending = $true }, @{ Expression = "term"; Descending = $false } |
        Select-Object -First $candidateCount

    $rawResults = New-Object 'System.Collections.Generic.List[object]'
    foreach ($candidate in @($candidateTerms)) {
        $chunk = Get-KnowledgeBaseIndexChunk -Backend $backend -ChunkNumber $candidate.chunk
        $entry = $chunk.PSObject.Properties | Where-Object { $_.Name -eq $candidate.term } | Select-Object -First 1
        if ($null -eq $entry) {
            continue
        }

        $links = New-Object 'System.Collections.Generic.List[object]'
        Add-KnowledgeBaseIndexLinks -Node $entry.Value -TermPath $candidate.term -Results $links
        foreach ($link in $links) {
            $linkTitle = [string]$link.title
            $linkPath = [string]$link.path
            $linkUrl = Resolve-KnowledgeBaseUrl -Backend $backend -PageUrlOrPath $linkPath
            $linkKey = ($linkUrl -split "#")[0]
            $titleScore = 0
            $lowerTitle = $linkTitle.ToLowerInvariant()

            if ($lowerTitle -eq $normalizedQuery) {
                $titleScore = 30
            }
            elseif ($lowerTitle.Contains($normalizedQuery)) {
                $titleScore = 20
            }
            else {
                $matchingTerms = @($queryTerms | Where-Object { $lowerTitle.Contains($_) })
                if ($matchingTerms.Count -gt 0) {
                    $titleScore = $matchingTerms.Count * 4
                }
            }

            $rawResults.Add([pscustomobject]@{
                title = $linkTitle
                termPath = [string]$link.termPath
                path = $linkPath
                url = $linkUrl
                key = $linkKey
                score = [int]$candidate.score + $titleScore
            })
        }
    }

    $results = $rawResults |
        Sort-Object @{ Expression = "score"; Descending = $true }, @{ Expression = "title"; Descending = $false } |
        Group-Object key |
        ForEach-Object {
            $_.Group | Sort-Object @{ Expression = "score"; Descending = $true } | Select-Object -First 1
        } |
        Sort-Object @{ Expression = "score"; Descending = $true }, @{ Expression = "title"; Descending = $false } |
        Select-Object -First $maxResults

    $lines = @("[$($backend.DisplayName)] Found $(@($results).Count) topic(s) for query: $query")
    foreach ($result in @($results)) {
        $lines += ("[{0}] {1} (matched: {2})" -f $backend.DisplayName, $result.title, $result.termPath)
        $lines += ("  {0}" -f $result.url)
    }

    return @{
        content = @(
            @{
                type = "text"
                text = ($lines -join "`n")
            }
        )
        structuredContent = @{
            source = $backend | Select-Object Name, DisplayName, Product, BaseUrl
            query = $query
            results = @($results) | Select-Object title, termPath, path, url, score
        }
    }
}

function Invoke-KnowledgeBaseGetPage {
    param($Arguments)

    if (-not $Arguments.pageUrlOrPath) {
        throw "Missing required argument: pageUrlOrPath"
    }

    $source = if ($Arguments.source) { [string]$Arguments.source } else { "auto" }
    $backend = @(Get-RequestedBackends -Product "knowledgebase" -Source $source) | Select-Object -First 1
    if ($null -eq $backend) {
        throw "No knowledge base backend matched source '$source'."
    }

    $pageUrl = Resolve-KnowledgeBaseUrl -Backend $backend -PageUrlOrPath ([string]$Arguments.pageUrlOrPath)
    $html = Invoke-PlainGetRequest -Uri $pageUrl
    $title = Get-HtmlTitle -Html $html
    $bodyText = Normalize-KnowledgeBaseMarkup -Html $html
    if ([string]::IsNullOrWhiteSpace($bodyText)) {
        $bodyText = "No body available."
    }

    $relativePath = Get-KnowledgeBaseRelativePath -Backend $backend -Url $pageUrl
    $text = @(
        "Source: $($backend.DisplayName)"
        "Title: $title"
        "Path: $relativePath"
        "URL: $pageUrl"
        ""
        $bodyText
    ) -join "`n"

    return @{
        content = @(
            @{
                type = "text"
                text = $text
            }
        )
        structuredContent = @{
            source = $backend | Select-Object Name, DisplayName, Product, BaseUrl
            page = @{
                title = $title
                path = $relativePath
                url = $pageUrl
                text = $bodyText
            }
        }
    }
}

function Invoke-AtlassianListSources {
    param($Arguments)

    $backends = Get-ConfiguredBackends
    if ($backends.Count -eq 0) {
        throw "No configured Atlassian sources were found. Update your local codexmgx-env.ps1 file or set the required environment variables."
    }

    $lines = @("Configured Atlassian sources:")
    foreach ($backend in $backends) {
        $lines += ("- {0}: {1} ({2})" -f $backend.Name, $backend.DisplayName, $backend.BaseUrl)
    }

    return @{
        content = @(
            @{
                type = "text"
                text = ($lines -join "`n")
            }
        )
        structuredContent = @{
            sources = $backends | Select-Object Name, DisplayName, Product, BaseUrl
        }
    }
}

$investigationScript = Join-Path $PSScriptRoot "codexmgx-investigation.ps1"
if (-not (Test-Path -LiteralPath $investigationScript)) {
    throw "Missing required investigation helper script: $investigationScript"
}

. $investigationScript

function Get-ToolDefinitions {
    $tools = @(
        @{
            name = "atlassian_list_sources"
            description = "List configured Atlassian sources exposed by this plugin."
            inputSchema = @{
                type = "object"
                properties = @{}
            }
        }
        @{
            name = "jira_search_issues"
            description = "Search Jira Cloud issues using JQL."
            inputSchema = @{
                type = "object"
                properties = @{
                    source = @{
                        type = "string"
                        description = "Jira source to search: auto or cloud."
                        enum = @("auto", "cloud")
                    }
                    jql = @{
                        type = "string"
                        description = "A Jira JQL query. Defaults to issues assigned to the current user."
                    }
                    maxResults = @{
                        type = "integer"
                        description = "Maximum number of issues to return per source."
                        minimum = 1
                        maximum = 100
                    }
                    fields = @{
                        type = "array"
                        items = @{
                            type = "string"
                        }
                        description = "Optional list of Jira fields to request."
                    }
                }
            }
        }
        @{
            name = "jira_get_issue"
            description = "Fetch one Jira Cloud issue by key."
            inputSchema = @{
                type = "object"
                properties = @{
                    source = @{
                        type = "string"
                        description = "Jira source to use: auto or cloud."
                        enum = @("auto", "cloud")
                    }
                    issueKey = @{
                        type = "string"
                        description = "Issue key such as PROJ-123."
                    }
                    fields = @{
                        type = "array"
                        items = @{
                            type = "string"
                        }
                        description = "Optional list of Jira fields to request."
                    }
                }
                required = @("issueKey")
            }
        }
        @{
            name = "jira_list_projects"
            description = "List Jira Cloud projects visible to the current user."
            inputSchema = @{
                type = "object"
                properties = @{
                    source = @{
                        type = "string"
                        description = "Jira source to use: auto or cloud."
                        enum = @("auto", "cloud")
                    }
                    maxResults = @{
                        type = "integer"
                        description = "Maximum number of projects to return per source."
                        minimum = 1
                        maximum = 100
                    }
                }
            }
        }
        @{
            name = "jira_get_myself"
            description = "Show the currently authenticated Jira Cloud user."
            inputSchema = @{
                type = "object"
                properties = @{
                    source = @{
                        type = "string"
                        description = "Jira source to use: auto or cloud."
                        enum = @("auto", "cloud")
                    }
                }
            }
        }
        @{
            name = "confluence_search_content"
            description = "Search Confluence Cloud content using a free-text query or raw CQL."
            inputSchema = @{
                type = "object"
                properties = @{
                    source = @{
                        type = "string"
                        description = "Confluence source to use: auto, cloud, or confluence."
                        enum = @("auto", "cloud", "confluence")
                    }
                    query = @{
                        type = "string"
                        description = "Free-text query to search in Confluence."
                    }
                    cql = @{
                        type = "string"
                        description = "Optional raw Confluence CQL query. If provided, it overrides query."
                    }
                    spaceKey = @{
                        type = "string"
                        description = "Optional Confluence space key to narrow the search."
                    }
                    ancestorId = @{
                        type = "string"
                        description = "Optional ancestor content ID to limit results to descendants of one Confluence page."
                    }
                    limit = @{
                        type = "integer"
                        description = "Maximum number of results to return."
                        minimum = 1
                        maximum = 50
                    }
                }
            }
        }
        @{
            name = "confluence_get_content"
            description = "Fetch one Confluence page or content item by content ID."
            inputSchema = @{
                type = "object"
                properties = @{
                    source = @{
                        type = "string"
                        description = "Confluence source to use: auto, cloud, or confluence."
                        enum = @("auto", "cloud", "confluence")
                    }
                    contentId = @{
                        type = "string"
                        description = "Confluence content ID."
                    }
                }
                required = @("contentId")
            }
        }
        @{
            name = "mod_search_documentation"
            description = "Search the Mediagenix On-Demand documentation in Confluence below the configured MOD home page."
            inputSchema = @{
                type = "object"
                properties = @{
                    source = @{
                        type = "string"
                        description = "Confluence source to use: auto, cloud, or confluence."
                        enum = @("auto", "cloud", "confluence")
                    }
                    query = @{
                        type = "string"
                        description = "Free-text query to search in MOD documentation."
                    }
                    cql = @{
                        type = "string"
                        description = "Optional raw Confluence CQL query. If provided, it still runs under the MOD documentation tool."
                    }
                    limit = @{
                        type = "integer"
                        description = "Maximum number of MOD documentation results to return."
                        minimum = 1
                        maximum = 50
                    }
                }
            }
        }
        @{
            name = "mod_get_documentation_page"
            description = "Fetch one MOD documentation page or item by content ID. Defaults to the MOD home page."
            inputSchema = @{
                type = "object"
                properties = @{
                    source = @{
                        type = "string"
                        description = "Confluence source to use: auto, cloud, or confluence."
                        enum = @("auto", "cloud", "confluence")
                    }
                    contentId = @{
                        type = "string"
                        description = "Optional Confluence content ID. Leave empty to fetch the configured MOD home page."
                    }
                }
            }
        }
        @{
            name = "knowledgebase_search_topics"
            description = "Search the WHATS'ON Knowledge Base topic index."
            inputSchema = @{
                type = "object"
                properties = @{
                    source = @{
                        type = "string"
                        description = "Knowledge base source to use: auto or knowledgebase."
                        enum = @("auto", "knowledgebase")
                    }
                    query = @{
                        type = "string"
                        description = "Search phrase to look up in the knowledge base index."
                    }
                    maxResults = @{
                        type = "integer"
                        description = "Maximum number of topics to return."
                        minimum = 1
                        maximum = 25
                    }
                }
                required = @("query")
            }
        }
        @{
            name = "knowledgebase_get_page"
            description = "Fetch one WHATS'ON Knowledge Base page by relative path or full URL."
            inputSchema = @{
                type = "object"
                properties = @{
                    source = @{
                        type = "string"
                        description = "Knowledge base source to use: auto or knowledgebase."
                        enum = @("auto", "knowledgebase")
                    }
                    pageUrlOrPath = @{
                        type = "string"
                        description = "A page path such as /Content/General/Home.htm or a full page URL."
                    }
                }
                required = @("pageUrlOrPath")
            }
        }
    )

    if (Get-Command Get-CodexMgxInvestigationToolDefinitions -ErrorAction SilentlyContinue) {
        $tools += @(Get-CodexMgxInvestigationToolDefinitions)
    }

    return $tools
}

function Invoke-ToolCall {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ToolName,
        [Parameter()]
        $Arguments
    )

    switch ($ToolName) {
        "atlassian_list_sources" { return (Invoke-AtlassianListSources -Arguments $Arguments) }
        "jira_search_issues" { return (Invoke-JiraSearchIssues -Arguments $Arguments) }
        "jira_get_issue" { return (Invoke-JiraGetIssue -Arguments $Arguments) }
        "jira_get_issue_full" { return (Invoke-JiraGetIssueFull -Arguments $Arguments) }
        "jira_search_related_issues" { return (Invoke-JiraSearchRelatedIssues -Arguments $Arguments) }
        "jira_get_attachment_text" { return (Invoke-JiraGetAttachmentText -Arguments $Arguments) }
        "jira_list_projects" { return (Invoke-JiraListProjects -Arguments $Arguments) }
        "jira_get_myself" { return (Invoke-JiraGetMyself -Arguments $Arguments) }
        "confluence_search_content" { return (Invoke-ConfluenceSearchContent -Arguments $Arguments) }
        "confluence_get_content" { return (Invoke-ConfluenceGetContent -Arguments $Arguments) }
        "confluence_get_related_content" { return (Invoke-ConfluenceGetRelatedContent -Arguments $Arguments) }
        "mod_search_documentation" { return (Invoke-ModDocumentationSearch -Arguments $Arguments) }
        "mod_get_documentation_page" { return (Invoke-ModDocumentationGetPage -Arguments $Arguments) }
        "knowledgebase_search_topics" { return (Invoke-KnowledgeBaseSearchTopics -Arguments $Arguments) }
        "knowledgebase_get_page" { return (Invoke-KnowledgeBaseGetPage -Arguments $Arguments) }
        "knowledgebase_expand_related_topics" { return (Invoke-KnowledgeBaseExpandRelatedTopics -Arguments $Arguments) }
        "investigate_ticket" { return (Invoke-InvestigateTicket -Arguments $Arguments) }
        "investigate_regression_family" { return (Invoke-InvestigateRegressionFamily -Arguments $Arguments) }
        "investigate_expected_behavior" { return (Invoke-InvestigateExpectedBehavior -Arguments $Arguments) }
        "investigate_customer_history" { return (Invoke-InvestigateCustomerHistory -Arguments $Arguments) }
        default { throw "Unknown tool: $ToolName" }
    }
}

function Write-McpMessage {
    param(
        [Parameter(Mandatory = $true)]
        $Message
    )

    $json = $Message | ConvertTo-Json -Depth 50 -Compress
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
    [Console]::OpenStandardOutput().Write([System.Text.Encoding]::ASCII.GetBytes("Content-Length: $($bytes.Length)`r`n`r`n"), 0, [System.Text.Encoding]::ASCII.GetByteCount("Content-Length: $($bytes.Length)`r`n`r`n"))
    [Console]::OpenStandardOutput().Write($bytes, 0, $bytes.Length)
    [Console]::OpenStandardOutput().Flush()
}

function Read-McpMessage {
    $inputStream = [Console]::OpenStandardInput()
    $reader = New-Object System.IO.StreamReader($inputStream, [System.Text.Encoding]::UTF8)

    $contentLength = $null
    while ($true) {
        $line = $reader.ReadLine()
        if ($null -eq $line) {
            return $null
        }
        if ($line -eq "") {
            break
        }
        if ($line -match "^Content-Length:\s*(\d+)$") {
            $contentLength = [int]$matches[1]
        }
    }

    if ($null -eq $contentLength) {
        throw "Missing Content-Length header."
    }

    $buffer = New-Object char[] $contentLength
    $offset = 0
    while ($offset -lt $contentLength) {
        $read = $reader.Read($buffer, $offset, $contentLength - $offset)
        if ($read -le 0) {
            throw "Unexpected end of input stream."
        }
        $offset += $read
    }

    $json = -join $buffer
    return $json | ConvertFrom-Json
}

function New-JsonRpcResult {
    param(
        [Parameter(Mandatory = $true)]
        $Id,
        [Parameter(Mandatory = $true)]
        $Result
    )

    return @{
        jsonrpc = "2.0"
        id = $Id
        result = $Result
    }
}

function New-JsonRpcError {
    param(
        $Id,
        [Parameter(Mandatory = $true)]
        [int]$Code,
        [Parameter(Mandatory = $true)]
        [string]$Message
    )

    return @{
        jsonrpc = "2.0"
        id = $Id
        error = @{
            code = $Code
            message = $Message
        }
    }
}

if ($MyInvocation.InvocationName -ne ".") {
    while ($true) {
        try {
            $request = Read-McpMessage
            if ($null -eq $request) {
                break
            }

            if (-not $request.method) {
                continue
            }

            switch ([string]$request.method) {
                "initialize" {
                    Write-McpMessage (New-JsonRpcResult -Id $request.id -Result @{
                        protocolVersion = "2024-11-05"
                        capabilities = @{
                            tools = @{}
                        }
                        serverInfo = @{
                            name = "codexmgx-powershell-mcp"
                            version = "0.6.1"
                        }
                    })
                }
                "notifications/initialized" {
                }
                "tools/list" {
                    Write-McpMessage (New-JsonRpcResult -Id $request.id -Result @{
                        tools = (Get-ToolDefinitions)
                    })
                }
                "tools/call" {
                    $toolName = [string]$request.params.name
                    $arguments = $request.params.arguments
                    $result = Invoke-ToolCall -ToolName $toolName -Arguments $arguments
                    Write-McpMessage (New-JsonRpcResult -Id $request.id -Result $result)
                }
                default {
                    Write-McpMessage (New-JsonRpcError -Id $request.id -Code -32601 -Message "Method not found: $($request.method)")
                }
            }
        }
        catch {
            $id = $null
            if ($request -and $request.id) {
                $id = $request.id
            }

            Write-McpMessage (New-JsonRpcError -Id $id -Code -32000 -Message $_.Exception.Message)
        }
    }
}
