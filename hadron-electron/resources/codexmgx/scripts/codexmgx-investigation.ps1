$script:CodexMgxIssueBundleCache = @{}
$script:CodexMgxAttachmentCache = @{}
$script:CodexMgxStopWords = @(
    "about", "after", "again", "against", "also", "among", "because", "before", "being", "below",
    "between", "cannot", "could", "customer", "customers", "detail", "during", "empty", "environment",
    "error", "from", "have", "having", "issue", "issues", "into", "itself", "more", "most", "network",
    "only", "other", "report", "reports", "same", "should", "since", "still", "such", "than", "that",
    "their", "them", "there", "these", "this", "ticket", "tickets", "those", "through", "until", "using",
    "with", "without", "would", "when", "where", "which", "while", "whose", "work", "works"
)

function Normalize-Whitespace {
    param(
        [AllowNull()]
        [AllowEmptyString()]
        [string]$Value
    )

    if ([string]::IsNullOrWhiteSpace($Value)) {
        return ""
    }

    $text = $Value -replace "[ \t]+", " "
    $text = $text -replace " *`r?`n *", "`n"
    $text = $text -replace "(\r?\n){3,}", "`n`n"
    return $text.Trim()
}

function Normalize-HtmlFragmentToText {
    param(
        [AllowNull()]
        [AllowEmptyString()]
        [string]$Html
    )

    if ([string]::IsNullOrWhiteSpace($Html)) {
        return ""
    }

    $text = $Html -replace "(?is)<script\b[^>]*>.*?</script>", " "
    $text = $text -replace "(?is)<style\b[^>]*>.*?</style>", " "
    $text = $text -replace "(?is)<!--.*?-->", " "
    $text = $text -replace "(?i)<br\s*/?>", "`n"
    $text = $text -replace "(?i)</(p|div|li|tr|h[1-6]|section|article|ul|ol|table)>", "`n"
    $text = $text -replace "(?i)<li[^>]*>", "- "
    $text = $text -replace "(?is)<[^>]+>", " "
    $text = [System.Net.WebUtility]::HtmlDecode($text)
    return Normalize-Whitespace -Value $text
}

function Convert-JiraAdfNodeToText {
    param(
        $Node
    )

    if ($null -eq $Node) {
        return ""
    }

    if ($Node -is [string]) {
        return [string]$Node
    }

    $nodeType = if ($Node.type) { [string]$Node.type } else { "" }
    $content = @($Node.content)
    $children = ($content | ForEach-Object { Convert-JiraAdfNodeToText -Node $_ }) -join ""

    switch ($nodeType) {
        "text" {
            $text = if ($Node.text) { [string]$Node.text } else { "" }
            $marks = @($Node.marks)
            if ($marks.Count -gt 0) {
                foreach ($mark in $marks) {
                    $markType = if ($mark.type) { [string]$mark.type } else { "" }
                    switch ($markType) {
                        "strong" { $text = "*$text*" }
                        "em" { $text = "_$text_" }
                        "code" { $text = "`"$text`"" }
                        "link" {
                            if ($mark.attrs -and $mark.attrs.href) {
                                $text = "$text ($([string]$mark.attrs.href))"
                            }
                        }
                    }
                }
            }

            return $text
        }
        "paragraph" { return "$children`n`n" }
        "heading" { return "$children`n`n" }
        "bulletList" { return "$children`n" }
        "orderedList" { return "$children`n" }
        "listItem" {
            $lines = @($children -split "\r?\n" | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
            if ($lines.Count -eq 0) {
                return ""
            }

            return ("- " + ($lines -join " ")) + "`n"
        }
        "hardBreak" { return "`n" }
        "rule" { return "`n---`n" }
        "codeBlock" { return "`n$children`n" }
        "blockquote" { return "> " + (($children -split "\r?\n") -join "`n> ") + "`n" }
        "panel" { return "$children`n" }
        "table" { return "$children`n" }
        "tableRow" { return "$children`n" }
        "tableCell" { return ($children.Trim()) + " | " }
        "tableHeader" { return ($children.Trim()) + " | " }
        "emoji" {
            if ($Node.attrs -and $Node.attrs.shortName) {
                return [string]$Node.attrs.shortName
            }

            return ""
        }
        "mention" {
            if ($Node.attrs -and $Node.attrs.text) {
                return [string]$Node.attrs.text
            }

            return ""
        }
        "inlineCard" {
            if ($Node.attrs -and $Node.attrs.url) {
                return [string]$Node.attrs.url
            }

            return ""
        }
        "mediaSingle" { return "$children`n" }
        "mediaGroup" { return "$children`n" }
        "media" {
            if ($Node.attrs -and $Node.attrs.alt) {
                return [string]$Node.attrs.alt
            }

            return ""
        }
        default { return $children }
    }
}

function Convert-JiraAdfToText {
    param(
        $Value
    )

    if ($null -eq $Value) {
        return ""
    }

    if ($Value -is [string]) {
        if ($Value -match "<[^>]+>") {
            return Normalize-HtmlFragmentToText -Html $Value
        }

        return Normalize-Whitespace -Value ([string]$Value)
    }

    if ($Value.type -and [string]$Value.type -eq "doc") {
        $text = Convert-JiraAdfNodeToText -Node $Value
        return Normalize-Whitespace -Value $text
    }

    try {
        $json = $Value | ConvertTo-Json -Depth 25
        return Normalize-Whitespace -Value $json
    }
    catch {
        return Normalize-Whitespace -Value ([string]$Value)
    }
}

function Get-IssueWebUrl {
    param(
        [Parameter(Mandatory = $true)]
        $Backend,
        [Parameter(Mandatory = $true)]
        [string]$IssueKey
    )

    return "{0}/browse/{1}" -f $Backend.BaseUrl.TrimEnd("/"), $IssueKey
}

function Get-CodexMgxTempRoot {
    $root = Join-Path ([System.IO.Path]::GetTempPath()) "codexmgx-plugin"
    if (-not (Test-Path -LiteralPath $root)) {
        New-Item -ItemType Directory -Path $root | Out-Null
    }

    return $root
}

function Get-PlainTextPreview {
    param(
        [AllowNull()]
        [AllowEmptyString()]
        [string]$Text,
        [int]$MaxLength = 240
    )

    $normalized = Normalize-Whitespace -Value $Text
    if ($normalized.Length -le $MaxLength) {
        return $normalized
    }

    return $normalized.Substring(0, $MaxLength).Trim() + "..."
}

function Get-CleanInvestigationSummary {
    param(
        [AllowNull()]
        [AllowEmptyString()]
        [string]$Summary
    )

    $text = Normalize-Whitespace -Value $Summary
    if ([string]::IsNullOrWhiteSpace($text)) {
        return ""
    }

    do {
        $previous = $text
        $text = $text -replace '^\s*(?:\([^)]+\)|\[[^\]]+\]|<[^>]+>)\s*', ''
    }
    while ($text -ne $previous)

    return $text.Trim()
}

function Add-UniqueStringValues {
    param(
        $Value,
        [Parameter(Mandatory = $true)]
        $Result,
        [Parameter(Mandatory = $true)]
        $Seen
    )

    if ($null -eq $Value) {
        return
    }

    if ($Value -is [string]) {
        $text = $Value.Trim()
        if (-not [string]::IsNullOrWhiteSpace($text) -and $Seen.Add($text)) {
            $Result.Add($text)
        }

        return
    }

    if ($Value -is [System.Collections.IDictionary]) {
        foreach ($dictionaryValue in $Value.Values) {
            Add-UniqueStringValues -Value $dictionaryValue -Result $Result -Seen $Seen
        }

        return
    }

    if ($Value -is [System.Collections.IEnumerable]) {
        foreach ($item in $Value) {
            Add-UniqueStringValues -Value $item -Result $Result -Seen $Seen
        }

        return
    }

    $text = ([string]$Value).Trim()
    if (-not [string]::IsNullOrWhiteSpace($text) -and $Seen.Add($text)) {
        $Result.Add($text)
    }
}

function Get-UniqueStrings {
    param(
        [Parameter()]
        [object[]]$Values
    )

    $result = New-Object 'System.Collections.Generic.List[string]'
    $seen = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
    foreach ($value in @($Values)) {
        Add-UniqueStringValues -Value $value -Result $result -Seen $seen
    }

    return $result.ToArray()
}

function Get-SearchTokens {
    param(
        [AllowNull()]
        [AllowEmptyString()]
        [string]$Text,
        [int]$MaxTokens = 10,
        [int]$MinLength = 4
    )

    $matches = [regex]::Matches(($Text | ForEach-Object { [string]$_ }), "[A-Za-z0-9][A-Za-z0-9_/-]*")
    $scored = @{}
    foreach ($match in $matches) {
        $token = $match.Value.Trim().ToLowerInvariant()
        if ($token.Length -lt $MinLength) {
            continue
        }

        if ($script:CodexMgxStopWords -contains $token) {
            continue
        }

        if ($token -match "^\d+$") {
            continue
        }

        if (-not $scored.ContainsKey($token)) {
            $scored[$token] = 0
        }

        $scored[$token] += 1
    }

    return $scored.GetEnumerator() |
        Sort-Object @{ Expression = "Value"; Descending = $true }, @{ Expression = "Name"; Descending = $false } |
        Select-Object -First $MaxTokens |
        ForEach-Object { $_.Name }
}

function Get-MatchedEntitiesForText {
    param(
        [AllowNull()]
        [AllowEmptyString()]
        [string]$Text,
        [Parameter()]
        [object[]]$Entities
    )

    $normalized = if ([string]::IsNullOrWhiteSpace($Text)) { "" } else { $Text.ToLowerInvariant() }
    $matches = @()
    foreach ($entity in @($Entities)) {
        $value = if ($null -eq $entity) { "" } else { [string]$entity }
        if ([string]::IsNullOrWhiteSpace($value)) {
            continue
        }

        if ($normalized.Contains($value.ToLowerInvariant())) {
            $matches += $value
        }
    }

    return Get-UniqueStrings -Values $matches
}

function Get-ClaimCategoryForEvidenceClass {
    param(
        [Parameter(Mandatory = $true)]
        [string]$EvidenceClass
    )

    switch ($EvidenceClass) {
        "current_ticket" { return "observed_behavior" }
        "linked_issue" { return "linked_context" }
        "historical_issue" { return "historical_match" }
        "documentation" { return "expected_behavior" }
        "attachment" { return "attachment_signal" }
        "comment" { return "issue_comment" }
        "customer_history" { return "customer_history" }
        default { return "supporting_context" }
    }
}

function New-CodexEvidenceClaim {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Text,
        [Parameter(Mandatory = $true)]
        [string]$Category,
        [Parameter()]
        [object[]]$Entities = @()
    )

    return [pscustomobject]@{
        text = Normalize-Whitespace -Value $Text
        category = $Category
        entities = Get-UniqueStrings -Values $Entities
    }
}

function New-CodexEvidenceItem {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Id,
        [Parameter(Mandatory = $true)]
        [string]$SourceType,
        [Parameter(Mandatory = $true)]
        [string]$EvidenceClass,
        [Parameter(Mandatory = $true)]
        [string]$Title,
        [Parameter()]
        [string]$Url = "",
        [Parameter()]
        [string]$SourceLabel = "",
        [Parameter()]
        [string]$FetchedBecause = "",
        [Parameter()]
        [object[]]$MatchedEntities = @(),
        [Parameter()]
        [int]$RelevanceScore = 50,
        [Parameter()]
        [double]$Confidence = 0.5,
        [Parameter()]
        [object[]]$Claims = @(),
        [Parameter()]
        [hashtable]$Metadata = @{}
    )

    return [pscustomobject]@{
        id = $Id
        sourceType = $SourceType
        evidenceClass = $EvidenceClass
        title = $Title
        url = $Url
        sourceLabel = $SourceLabel
        fetchedBecause = $FetchedBecause
        matchedEntities = Get-UniqueStrings -Values $MatchedEntities
        relevanceScore = $RelevanceScore
        confidence = [Math]::Round($Confidence, 2)
        extractedClaims = @($Claims)
        contradictions = @()
        metadata = $Metadata
    }
}

function Get-TextClaims {
    param(
        [AllowNull()]
        [AllowEmptyString()]
        [string]$Text,
        [Parameter(Mandatory = $true)]
        [string]$EvidenceClass,
        [Parameter()]
        [object[]]$Entities = @(),
        [int]$MaxClaims = 3
    )

    $normalized = Normalize-Whitespace -Value $Text
    if ([string]::IsNullOrWhiteSpace($normalized)) {
        return @()
    }

    $sentences = @($normalized -split "(?<=[\.\!\?])\s+|\r?\n" | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    $claims = New-Object 'System.Collections.Generic.List[object]'
    $category = Get-ClaimCategoryForEvidenceClass -EvidenceClass $EvidenceClass
    foreach ($sentence in $sentences) {
        $matched = Get-MatchedEntitiesForText -Text $sentence -Entities $Entities
        if ($matched.Count -eq 0 -and $claims.Count -ge 1) {
            continue
        }

        $claims.Add((New-CodexEvidenceClaim -Text $sentence -Category $category -Entities $matched))
        if ($claims.Count -ge $MaxClaims) {
            break
        }
    }

    if ($claims.Count -eq 0) {
        $claims.Add((New-CodexEvidenceClaim -Text (Get-PlainTextPreview -Text $normalized -MaxLength 200) -Category $category -Entities $Entities))
    }

    return $claims.ToArray()
}

function Convert-JiraRenderedCommentToText {
    param(
        $RenderedComment,
        $RawComment
    )

    if ($RenderedComment -and $RenderedComment.body) {
        return Normalize-HtmlFragmentToText -Html ([string]$RenderedComment.body)
    }

    if ($RawComment -and $RawComment.body) {
        return Convert-JiraAdfToText -Value $RawComment.body
    }

    return ""
}

function Convert-JiraCommentCollection {
    param(
        [Parameter(Mandatory = $true)]
        $IssueResult
    )

    $rawComments = if ($IssueResult.fields -and $IssueResult.fields.comment -and $IssueResult.fields.comment.comments) {
        @($IssueResult.fields.comment.comments)
    }
    else {
        @()
    }

    $renderedComments = if ($IssueResult.renderedFields -and $IssueResult.renderedFields.comment -and $IssueResult.renderedFields.comment.comments) {
        @($IssueResult.renderedFields.comment.comments)
    }
    else {
        @()
    }

    $items = @()
    for ($i = 0; $i -lt $rawComments.Count; $i++) {
        $raw = $rawComments[$i]
        $rendered = if ($i -lt $renderedComments.Count) { $renderedComments[$i] } else { $null }
        $author = if ($raw.author -and $raw.author.displayName) { [string]$raw.author.displayName } else { "" }
        $text = Convert-JiraRenderedCommentToText -RenderedComment $rendered -RawComment $raw
        $items += [pscustomobject]@{
            id = if ($raw.id) { [string]$raw.id } else { "" }
            author = $author
            created = if ($raw.created) { [string]$raw.created } else { "" }
            updated = if ($raw.updated) { [string]$raw.updated } else { "" }
            text = $text
            raw = $raw
        }
    }

    return $items
}

function Convert-JiraChangelogHistory {
    param(
        [Parameter(Mandatory = $true)]
        $History
    )

    return [pscustomobject]@{
        id = if ($History.id) { [string]$History.id } else { "" }
        created = if ($History.created) { [string]$History.created } else { "" }
        author = if ($History.author -and $History.author.displayName) { [string]$History.author.displayName } else { "" }
        items = @($History.items) | ForEach-Object {
            [pscustomobject]@{
                field = if ($_.field) { [string]$_.field } else { "" }
                from = if ($_.fromString) { [string]$_.fromString } else { "" }
                to = if ($_.toString) { [string]$_.toString } else { "" }
            }
        }
    }
}

function Invoke-BackendDownload {
    param(
        [Parameter(Mandatory = $true)]
        $Backend,
        [Parameter(Mandatory = $true)]
        [string]$Uri,
        [Parameter(Mandatory = $true)]
        [string]$OutputPath
    )

    $headers = @{
        Authorization = (Get-BasicAuthHeader -Principal $Backend.Principal -Secret $Backend.Secret)
        Accept = "*/*"
    }

    Invoke-WebRequest -Method "GET" -Uri $Uri -Headers $headers -OutFile $OutputPath -TimeoutSec 90 | Out-Null
}

function Invoke-JiraGetIssueChangelogOnBackend {
    param(
        [Parameter(Mandatory = $true)]
        $Backend,
        [Parameter(Mandatory = $true)]
        [string]$IssueKey
    )

    $all = @()
    $startAt = 0
    $maxResults = 100
    while ($true) {
        $path = "/rest/api/3/issue/${IssueKey}/changelog?startAt=$startAt&maxResults=$maxResults"
        $result = Invoke-BackendApi -Backend $Backend -Method "GET" -Path $path
        $values = @($result.values)
        $all += $values
        $startAt += $values.Count
        if ($values.Count -lt $maxResults) {
            break
        }
    }

    return @($all)
}

function Invoke-JiraGetIssueWorklogsOnBackend {
    param(
        [Parameter(Mandatory = $true)]
        $Backend,
        [Parameter(Mandatory = $true)]
        [string]$IssueKey
    )

    $all = @()
    $startAt = 0
    $maxResults = 100
    while ($true) {
        $path = "/rest/api/3/issue/${IssueKey}/worklog?startAt=$startAt&maxResults=$maxResults"
        $result = Invoke-BackendApi -Backend $Backend -Method "GET" -Path $path
        $values = @($result.worklogs)
        $all += $values
        $startAt += $values.Count
        if ($values.Count -lt $maxResults) {
            break
        }
    }

    return @($all)
}

function Invoke-JiraGetIssueRemoteLinksOnBackend {
    param(
        [Parameter(Mandatory = $true)]
        $Backend,
        [Parameter(Mandatory = $true)]
        [string]$IssueKey
    )

    return @(Invoke-BackendApi -Backend $Backend -Method "GET" -Path "/rest/api/3/issue/${IssueKey}/remotelink")
}

function Invoke-JiraGetProjectDetailsOnBackend {
    param(
        [Parameter(Mandatory = $true)]
        $Backend,
        [Parameter(Mandatory = $true)]
        [string]$ProjectKey
    )

    return Invoke-BackendApi -Backend $Backend -Method "GET" -Path "/rest/api/3/project/$([uri]::EscapeDataString($ProjectKey))"
}

function Invoke-JiraGetProjectVersionsOnBackend {
    param(
        [Parameter(Mandatory = $true)]
        $Backend,
        [Parameter(Mandatory = $true)]
        [string]$ProjectKey
    )

    return @(Invoke-BackendApi -Backend $Backend -Method "GET" -Path "/rest/api/3/project/$([uri]::EscapeDataString($ProjectKey))/versions")
}

function Invoke-JiraGetProjectComponentsOnBackend {
    param(
        [Parameter(Mandatory = $true)]
        $Backend,
        [Parameter(Mandatory = $true)]
        [string]$ProjectKey
    )

    return @(Invoke-BackendApi -Backend $Backend -Method "GET" -Path "/rest/api/3/project/$([uri]::EscapeDataString($ProjectKey))/components")
}

function Invoke-JiraGetBoardsOnBackend {
    param(
        [Parameter(Mandatory = $true)]
        $Backend,
        [Parameter(Mandatory = $true)]
        [string]$ProjectKey,
        [int]$MaxResults = 25
    )

    return Invoke-BackendApi -Backend $Backend -Method "GET" -Path "/rest/agile/1.0/board?projectKeyOrId=$([uri]::EscapeDataString($ProjectKey))&maxResults=$MaxResults"
}

function Get-JiraNamedCustomFields {
    param(
        [Parameter(Mandatory = $true)]
        $IssueResult
    )

    $items = @()
    if (-not $IssueResult.fields) {
        return $items
    }

    foreach ($property in $IssueResult.fields.PSObject.Properties) {
        $fieldId = [string]$property.Name
        $fieldName = if ($IssueResult.names -and $IssueResult.names.PSObject.Properties.Name -contains $fieldId) {
            [string]$IssueResult.names.$fieldId
        }
        else {
            $fieldId
        }

        $items += [pscustomobject]@{
            id = $fieldId
            name = $fieldName
            value = $property.Value
        }
    }

    return $items
}

function Get-JiraAgileContext {
    param(
        [Parameter(Mandatory = $true)]
        $IssueResult,
        [Parameter()]
        [object[]]$Boards = @()
    )

    $namedFields = Get-JiraNamedCustomFields -IssueResult $IssueResult
    $agileFields = @($namedFields | Where-Object {
        $_.name -match "Sprint|Epic|Board|Story Points|Parent Link|Rank"
    })

    $items = @()
    foreach ($field in $agileFields) {
        $text = Convert-JiraAdfToText -Value $field.value
        if ([string]::IsNullOrWhiteSpace($text)) {
            try {
                $text = ($field.value | ConvertTo-Json -Depth 15 -Compress)
            }
            catch {
                $text = [string]$field.value
            }
        }

        $items += [pscustomobject]@{
            id = $field.id
            name = $field.name
            text = Get-PlainTextPreview -Text $text -MaxLength 240
        }
    }

    $boardItems = @()
    foreach ($board in @($Boards)) {
        $boardItems += [pscustomobject]@{
            id = if ($board.id) { [string]$board.id } else { "" }
            name = if ($board.name) { [string]$board.name } else { "" }
            type = if ($board.type) { [string]$board.type } else { "" }
            location = if ($board.location -and $board.location.displayName) { [string]$board.location.displayName } else { "" }
        }
    }

    return [pscustomobject]@{
        fields = $items
        boards = $boardItems
    }
}

function Convert-JiraWorklog {
    param(
        [Parameter(Mandatory = $true)]
        $Worklog
    )

    return [pscustomobject]@{
        id = if ($Worklog.id) { [string]$Worklog.id } else { "" }
        author = if ($Worklog.author -and $Worklog.author.displayName) { [string]$Worklog.author.displayName } else { "" }
        started = if ($Worklog.started) { [string]$Worklog.started } else { "" }
        updated = if ($Worklog.updated) { [string]$Worklog.updated } else { "" }
        timeSpent = if ($Worklog.timeSpent) { [string]$Worklog.timeSpent } else { "" }
        comment = if ($Worklog.comment) { Convert-JiraAdfToText -Value $Worklog.comment } else { "" }
    }
}

function Convert-JiraRemoteLink {
    param(
        [Parameter(Mandatory = $true)]
        $RemoteLink
    )

    $object = if ($RemoteLink.object) { $RemoteLink.object } else { $null }
    return [pscustomobject]@{
        id = if ($RemoteLink.id) { [string]$RemoteLink.id } else { "" }
        title = if ($object -and $object.title) { [string]$object.title } else { "" }
        summary = if ($object -and $object.summary) { [string]$object.summary } else { "" }
        url = if ($object -and $object.url) { [string]$object.url } else { "" }
        application = if ($RemoteLink.application -and $RemoteLink.application.name) { [string]$RemoteLink.application.name } else { "" }
    }
}

function Convert-JiraAttachmentMetadata {
    param(
        [Parameter(Mandatory = $true)]
        $Attachment
    )

    return [pscustomobject]@{
        id = if ($Attachment.id) { [string]$Attachment.id } else { "" }
        fileName = if ($Attachment.filename) { [string]$Attachment.filename } else { "" }
        mimeType = if ($Attachment.mimeType) { [string]$Attachment.mimeType } else { "" }
        size = if ($Attachment.size) { [int]$Attachment.size } else { 0 }
        created = if ($Attachment.created) { [string]$Attachment.created } else { "" }
        contentUrl = if ($Attachment.content) { [string]$Attachment.content } else { "" }
        thumbnailUrl = if ($Attachment.thumbnail) { [string]$Attachment.thumbnail } else { "" }
        author = if ($Attachment.author -and $Attachment.author.displayName) { [string]$Attachment.author.displayName } else { "" }
    }
}

function Get-JiraProjectContext {
    param(
        [Parameter(Mandatory = $true)]
        $Backend,
        [AllowNull()]
        $IssueResult
    )

    if ($null -eq $IssueResult -or -not $IssueResult.fields -or -not $IssueResult.fields.project -or -not $IssueResult.fields.project.key) {
        return $null
    }

    $projectKey = [string]$IssueResult.fields.project.key
    $details = $null
    $versions = @()
    $components = @()
    $boards = @()

    try {
        $details = Invoke-JiraGetProjectDetailsOnBackend -Backend $Backend -ProjectKey $projectKey
    }
    catch {
    }

    try {
        $versions = Invoke-JiraGetProjectVersionsOnBackend -Backend $Backend -ProjectKey $projectKey
    }
    catch {
    }

    try {
        $components = Invoke-JiraGetProjectComponentsOnBackend -Backend $Backend -ProjectKey $projectKey
    }
    catch {
    }

    try {
        $boardsResult = Invoke-JiraGetBoardsOnBackend -Backend $Backend -ProjectKey $projectKey
        $boards = @($boardsResult.values)
    }
    catch {
    }

    return [pscustomobject]@{
        project = $details
        versions = @($versions) | Select-Object id, name, released, archived, releaseDate
        components = @($components) | Select-Object id, name, description
        boards = @($boards) | Select-Object id, name, type, location
    }
}

function Get-JiraIssueBundleCacheKey {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Source,
        [Parameter(Mandatory = $true)]
        [string]$IssueKey
    )

    return "{0}|{1}" -f $Source.ToLowerInvariant(), $IssueKey.ToUpperInvariant()
}

function Get-JiraIssueBundle {
    param(
        [Parameter(Mandatory = $true)]
        $Backend,
        [Parameter(Mandatory = $true)]
        [string]$IssueKey
    )

    $cacheKey = Get-JiraIssueBundleCacheKey -Source $Backend.Name -IssueKey $IssueKey
    if ($script:CodexMgxIssueBundleCache.ContainsKey($cacheKey)) {
        return $script:CodexMgxIssueBundleCache[$cacheKey]
    }

    $result = Invoke-BackendApi -Backend $Backend -Method "GET" -Path "/rest/api/3/issue/${IssueKey}?expand=renderedFields,names,schema"
    $comments = Convert-JiraCommentCollection -IssueResult $result
    $changelog = @()
    try {
        $changelog = @(Invoke-JiraGetIssueChangelogOnBackend -Backend $Backend -IssueKey $IssueKey | ForEach-Object { Convert-JiraChangelogHistory -History $_ })
    }
    catch {
    }

    $worklogs = @()
    try {
        $worklogs = @(Invoke-JiraGetIssueWorklogsOnBackend -Backend $Backend -IssueKey $IssueKey | ForEach-Object { Convert-JiraWorklog -Worklog $_ })
    }
    catch {
    }

    $remoteLinks = @()
    try {
        $remoteLinks = @(Invoke-JiraGetIssueRemoteLinksOnBackend -Backend $Backend -IssueKey $IssueKey | ForEach-Object { Convert-JiraRemoteLink -RemoteLink $_ })
    }
    catch {
    }

    $projectContext = Get-JiraProjectContext -Backend $Backend -IssueResult $result
    $agileContext = Get-JiraAgileContext -IssueResult $result -Boards @($projectContext.boards)
    $attachments = if ($result.fields -and $result.fields.attachment) {
        @($result.fields.attachment | ForEach-Object { Convert-JiraAttachmentMetadata -Attachment $_ })
    }
    else {
        @()
    }

    $descriptionText = if ($result.renderedFields -and $result.renderedFields.description) {
        Normalize-HtmlFragmentToText -Html ([string]$result.renderedFields.description)
    }
    elseif ($result.fields -and $result.fields.description) {
        Convert-JiraAdfToText -Value $result.fields.description
    }
    else {
        ""
    }

    $linkedIssues = @()
    foreach ($link in @($result.fields.issuelinks)) {
        if ($link.outwardIssue) {
            $linkedIssues += [pscustomobject]@{
                direction = if ($link.type -and $link.type.outward) { [string]$link.type.outward } else { "outward" }
                issue = $link.outwardIssue
            }
        }

        if ($link.inwardIssue) {
            $linkedIssues += [pscustomobject]@{
                direction = if ($link.type -and $link.type.inward) { [string]$link.type.inward } else { "inward" }
                issue = $link.inwardIssue
            }
        }
    }

    $bundle = [pscustomobject]@{
        source = $Backend | Select-Object Name, DisplayName, Product, BaseUrl
        issue = $result
        issueUrl = Get-IssueWebUrl -Backend $Backend -IssueKey $IssueKey
        summary = if ($result.fields.summary) { [string]$result.fields.summary } else { "" }
        descriptionText = $descriptionText
        comments = $comments
        changelog = $changelog
        worklogs = $worklogs
        remoteLinks = $remoteLinks
        attachments = $attachments
        linkedIssues = $linkedIssues
        projectContext = $projectContext
        agileContext = $agileContext
    }

    $script:CodexMgxIssueBundleCache[$cacheKey] = $bundle
    return $bundle
}

function Convert-ZipEntryToText {
    param(
        [Parameter(Mandatory = $true)]
        [System.IO.Compression.ZipArchiveEntry]$Entry,
        [int]$MaxBytes = 262144
    )

    if ($Entry.Length -gt $MaxBytes) {
        return [pscustomobject]@{
            name = $Entry.FullName
            text = ""
            note = "Skipped because the archive entry is larger than the supported preview size."
        }
    }

    $stream = $Entry.Open()
    try {
        $memory = New-Object System.IO.MemoryStream
        $stream.CopyTo($memory)
        $bytes = $memory.ToArray()
    }
    finally {
        $stream.Dispose()
    }

    $extension = [System.IO.Path]::GetExtension($Entry.Name).ToLowerInvariant()
    $tempPath = Join-Path (Get-CodexMgxTempRoot) ([System.Guid]::NewGuid().ToString() + $extension)
    [System.IO.File]::WriteAllBytes($tempPath, $bytes)
    try {
        $extracted = Get-ExtractedTextFromFile -Path $tempPath -FileName $Entry.Name -MimeType ""
        return [pscustomobject]@{
            name = $Entry.FullName
            text = $extracted.text
            note = $extracted.note
        }
    }
    finally {
        Remove-Item -LiteralPath $tempPath -ErrorAction SilentlyContinue
    }
}

function Get-TesseractPath {
    $command = Get-Command "tesseract.exe" -ErrorAction SilentlyContinue
    if ($command) {
        return $command.Source
    }

    return $null
}

function Invoke-OptionalImageOcr {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    $tesseractPath = Get-TesseractPath
    if ([string]::IsNullOrWhiteSpace($tesseractPath)) {
        return [pscustomobject]@{
            text = ""
            note = "OCR was not attempted because tesseract.exe is not available on this machine."
            ocrUsed = $false
        }
    }

    $outputBase = Join-Path (Get-CodexMgxTempRoot) ([System.Guid]::NewGuid().ToString())
    & $tesseractPath $Path $outputBase quiet 2>$null | Out-Null
    $outputPath = "${outputBase}.txt"
    if (-not (Test-Path -LiteralPath $outputPath)) {
        return [pscustomobject]@{
            text = ""
            note = "OCR was attempted through Tesseract but no text output was produced."
            ocrUsed = $true
        }
    }

    try {
        return [pscustomobject]@{
            text = Normalize-Whitespace -Value (Get-Content -LiteralPath $outputPath -Raw)
            note = "OCR text was extracted with Tesseract."
            ocrUsed = $true
        }
    }
    finally {
        Remove-Item -LiteralPath $outputPath -ErrorAction SilentlyContinue
    }
}

function Convert-ByteArrayToBestEffortText {
    param(
        [Parameter(Mandatory = $true)]
        [byte[]]$Bytes
    )

    if ($Bytes.Length -eq 0) {
        return ""
    }

    if ($Bytes.Length -ge 3 -and $Bytes[0] -eq 0xEF -and $Bytes[1] -eq 0xBB -and $Bytes[2] -eq 0xBF) {
        return [System.Text.Encoding]::UTF8.GetString($Bytes, 3, $Bytes.Length - 3)
    }

    if ($Bytes.Length -ge 2 -and $Bytes[0] -eq 0xFF -and $Bytes[1] -eq 0xFE) {
        return [System.Text.Encoding]::Unicode.GetString($Bytes, 2, $Bytes.Length - 2)
    }

    if ($Bytes.Length -ge 2 -and $Bytes[0] -eq 0xFE -and $Bytes[1] -eq 0xFF) {
        return [System.Text.Encoding]::BigEndianUnicode.GetString($Bytes, 2, $Bytes.Length - 2)
    }

    try {
        $utf8 = New-Object System.Text.UTF8Encoding($false, $true)
        return $utf8.GetString($Bytes)
    }
    catch {
    }

    try {
        return [System.Text.Encoding]::GetEncoding("ISO-8859-1").GetString($Bytes)
    }
    catch {
        return [System.Text.Encoding]::ASCII.GetString($Bytes)
    }
}

function Convert-WordprocessingXmlToText {
    param(
        [Parameter(Mandatory = $true)]
        [string]$XmlText
    )

    if ([string]::IsNullOrWhiteSpace($XmlText)) {
        return ""
    }

    try {
        $xml = New-Object System.Xml.XmlDocument
        $xml.LoadXml($XmlText)
        $namespaceManager = New-Object System.Xml.XmlNamespaceManager($xml.NameTable)
        $namespaceManager.AddNamespace("w", "http://schemas.openxmlformats.org/wordprocessingml/2006/main")

        $paragraphs = New-Object 'System.Collections.Generic.List[string]'
        foreach ($paragraph in @($xml.SelectNodes("//w:p", $namespaceManager))) {
            $fragments = New-Object 'System.Collections.Generic.List[string]'
            foreach ($node in @($paragraph.SelectNodes(".//w:t | .//w:tab | .//w:br | .//w:cr", $namespaceManager))) {
                switch ($node.LocalName) {
                    "t" { $fragments.Add([string]$node.InnerText) }
                    "tab" { $fragments.Add("`t") }
                    default { $fragments.Add("`n") }
                }
            }

            $paragraphText = Normalize-Whitespace -Value (($fragments.ToArray()) -join "")
            if (-not [string]::IsNullOrWhiteSpace($paragraphText)) {
                $paragraphs.Add($paragraphText)
            }
        }

        return Normalize-Whitespace -Value (($paragraphs.ToArray()) -join "`n`n")
    }
    catch {
        return Normalize-Whitespace -Value $XmlText
    }
}

function Expand-PdfFlateBytes {
    param(
        [Parameter(Mandatory = $true)]
        [byte[]]$Bytes
    )

    $attempts = New-Object 'System.Collections.Generic.List[byte[]]'
    $attempts.Add($Bytes)
    if ($Bytes.Length -gt 6) {
        $trimmed = New-Object byte[] ($Bytes.Length - 6)
        [Array]::Copy($Bytes, 2, $trimmed, 0, $trimmed.Length)
        $attempts.Add($trimmed)
    }

    foreach ($candidate in @($attempts)) {
        $input = New-Object System.IO.MemoryStream(,$candidate)
        $output = New-Object System.IO.MemoryStream
        try {
            $stream = New-Object System.IO.Compression.DeflateStream($input, [System.IO.Compression.CompressionMode]::Decompress)
            try {
                $stream.CopyTo($output)
                return $output.ToArray()
            }
            finally {
                $stream.Dispose()
            }
        }
        catch {
        }
        finally {
            $input.Dispose()
            $output.Dispose()
        }
    }

    return $null
}

function Convert-PdfLiteralStringToText {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Text
    )

    $value = [regex]::Replace($Text, '\\([0-7]{1,3})', {
            param($match)
            [char][Convert]::ToInt32($match.Groups[1].Value, 8)
        })
    $value = $value -replace '\\n', "`n"
    $value = $value -replace '\\r', ""
    $value = $value -replace '\\t', "`t"
    $value = $value -replace '\\b', " "
    $value = $value -replace '\\f', " "
    $value = $value -replace '\\\(', "("
    $value = $value -replace '\\\)', ")"
    $value = $value -replace '\\\\', '\'
    return Normalize-Whitespace -Value $value
}

function Convert-PdfHexStringToText {
    param(
        [Parameter(Mandatory = $true)]
        [string]$HexText
    )

    $clean = ($HexText -replace '\s+', '')
    if ([string]::IsNullOrWhiteSpace($clean)) {
        return ""
    }

    if (($clean.Length % 2) -ne 0) {
        $clean += "0"
    }

    $bytes = New-Object byte[] ($clean.Length / 2)
    for ($index = 0; $index -lt $clean.Length; $index += 2) {
        $bytes[$index / 2] = [Convert]::ToByte($clean.Substring($index, 2), 16)
    }

    return Normalize-Whitespace -Value (Convert-ByteArrayToBestEffortText -Bytes $bytes)
}

function Get-PdfTextFromContentString {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Text
    )

    if ([string]::IsNullOrWhiteSpace($Text)) {
        return ""
    }

    $parts = New-Object 'System.Collections.Generic.List[string]'
    foreach ($match in [regex]::Matches($Text, '(?s)\((?<txt>(?:\\.|[^\\)]){1,600})\)\s*(?:Tj|''|")')) {
        $candidate = Convert-PdfLiteralStringToText -Text $match.Groups["txt"].Value
        if (-not [string]::IsNullOrWhiteSpace($candidate)) {
            $parts.Add($candidate)
        }
    }

    foreach ($match in [regex]::Matches($Text, '(?s)<(?<hex>[0-9A-Fa-f\s]{2,2400})>\s*(?:Tj|''|")')) {
        $candidate = Convert-PdfHexStringToText -HexText $match.Groups["hex"].Value
        if (-not [string]::IsNullOrWhiteSpace($candidate)) {
            $parts.Add($candidate)
        }
    }

    foreach ($match in [regex]::Matches($Text, '(?s)\[(?<arr>.*?)\]\s*TJ')) {
        $arrayBody = $match.Groups["arr"].Value
        foreach ($literal in [regex]::Matches($arrayBody, '\((?<txt>(?:\\.|[^\\)]){1,600})\)')) {
            $candidate = Convert-PdfLiteralStringToText -Text $literal.Groups["txt"].Value
            if (-not [string]::IsNullOrWhiteSpace($candidate)) {
                $parts.Add($candidate)
            }
        }

        foreach ($hex in [regex]::Matches($arrayBody, '<(?<hex>[0-9A-Fa-f\s]{2,2400})>')) {
            $candidate = Convert-PdfHexStringToText -HexText $hex.Groups["hex"].Value
            if (-not [string]::IsNullOrWhiteSpace($candidate)) {
                $parts.Add($candidate)
            }
        }
    }

    return Normalize-Whitespace -Value ((Get-UniqueStrings -Values $parts.ToArray()) -join "`n")
}

function Convert-PdfBytesToText {
    param(
        [Parameter(Mandatory = $true)]
        [byte[]]$Bytes
    )

    $latin1 = [System.Text.Encoding]::GetEncoding("ISO-8859-1").GetString($Bytes)
    $parts = New-Object 'System.Collections.Generic.List[string]'
    $notes = New-Object 'System.Collections.Generic.List[string]'

    $directText = Get-PdfTextFromContentString -Text $latin1
    if (-not [string]::IsNullOrWhiteSpace($directText)) {
        $parts.Add($directText)
        $notes.Add("direct PDF text operators")
    }

    foreach ($match in [regex]::Matches($latin1, '(?s)<<(?<dict>.*?)>>\s*stream\r?\n')) {
        $startIndex = $match.Index + $match.Length
        $endIndex = $latin1.IndexOf("endstream", $startIndex, [System.StringComparison]::Ordinal)
        if ($endIndex -lt 0 -or $endIndex -le $startIndex) {
            continue
        }

        while ($endIndex -gt $startIndex -and ($Bytes[$endIndex - 1] -eq 10 -or $Bytes[$endIndex - 1] -eq 13)) {
            $endIndex -= 1
        }

        $streamLength = $endIndex - $startIndex
        if ($streamLength -le 0) {
            continue
        }

        $streamBytes = New-Object byte[] $streamLength
        [Array]::Copy($Bytes, $startIndex, $streamBytes, 0, $streamLength)

        $streamText = Get-PdfTextFromContentString -Text (Convert-ByteArrayToBestEffortText -Bytes $streamBytes)
        if (-not [string]::IsNullOrWhiteSpace($streamText)) {
            $parts.Add($streamText)
            $notes.Add("embedded stream text")
        }

        if ($match.Groups["dict"].Value -match "/FlateDecode") {
            $expanded = Expand-PdfFlateBytes -Bytes $streamBytes
            if ($null -ne $expanded -and $expanded.Length -gt 0) {
                $expandedText = Get-PdfTextFromContentString -Text (Convert-ByteArrayToBestEffortText -Bytes $expanded)
                if (-not [string]::IsNullOrWhiteSpace($expandedText)) {
                    $parts.Add($expandedText)
                    $notes.Add("flate-decoded stream text")
                }
            }
        }
    }

    $text = Normalize-Whitespace -Value ((Get-UniqueStrings -Values $parts.ToArray()) -join "`n`n")
    if ([string]::IsNullOrWhiteSpace($text)) {
        return [pscustomobject]@{
            text = ""
            note = "The PDF did not expose extractable text through the built-in parser."
        }
    }

    return [pscustomobject]@{
        text = $text
        note = "Text was extracted with the built-in PDF parser using $((Get-UniqueStrings -Values $notes.ToArray()) -join ', ')."
    }
}

function Get-ExtractedTextFromFile {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,
        [Parameter(Mandatory = $true)]
        [string]$FileName,
        [string]$MimeType = ""
    )

    $extension = [System.IO.Path]::GetExtension($FileName).ToLowerInvariant()
    switch ($extension) {
        ".txt" { return [pscustomobject]@{ text = Normalize-Whitespace -Value (Get-Content -LiteralPath $Path -Raw); note = "Plain text extracted."; supported = $true } }
        ".log" { return [pscustomobject]@{ text = Normalize-Whitespace -Value (Get-Content -LiteralPath $Path -Raw); note = "Log text extracted."; supported = $true } }
        ".md" { return [pscustomobject]@{ text = Normalize-Whitespace -Value (Get-Content -LiteralPath $Path -Raw); note = "Markdown text extracted."; supported = $true } }
        ".csv" { return [pscustomobject]@{ text = Normalize-Whitespace -Value (Get-Content -LiteralPath $Path -Raw); note = "CSV text extracted."; supported = $true } }
        ".yaml" { return [pscustomobject]@{ text = Normalize-Whitespace -Value (Get-Content -LiteralPath $Path -Raw); note = "YAML text extracted."; supported = $true } }
        ".yml" { return [pscustomobject]@{ text = Normalize-Whitespace -Value (Get-Content -LiteralPath $Path -Raw); note = "YAML text extracted."; supported = $true } }
        ".ini" { return [pscustomobject]@{ text = Normalize-Whitespace -Value (Get-Content -LiteralPath $Path -Raw); note = "INI text extracted."; supported = $true } }
        ".cfg" { return [pscustomobject]@{ text = Normalize-Whitespace -Value (Get-Content -LiteralPath $Path -Raw); note = "Config text extracted."; supported = $true } }
        ".config" { return [pscustomobject]@{ text = Normalize-Whitespace -Value (Get-Content -LiteralPath $Path -Raw); note = "Config text extracted."; supported = $true } }
        ".properties" { return [pscustomobject]@{ text = Normalize-Whitespace -Value (Get-Content -LiteralPath $Path -Raw); note = "Properties text extracted."; supported = $true } }
        ".sql" { return [pscustomobject]@{ text = Normalize-Whitespace -Value (Get-Content -LiteralPath $Path -Raw); note = "SQL text extracted."; supported = $true } }
        ".ps1" { return [pscustomobject]@{ text = Normalize-Whitespace -Value (Get-Content -LiteralPath $Path -Raw); note = "PowerShell text extracted."; supported = $true } }
        ".psm1" { return [pscustomobject]@{ text = Normalize-Whitespace -Value (Get-Content -LiteralPath $Path -Raw); note = "PowerShell module text extracted."; supported = $true } }
        ".bat" { return [pscustomobject]@{ text = Normalize-Whitespace -Value (Get-Content -LiteralPath $Path -Raw); note = "Batch text extracted."; supported = $true } }
        ".cmd" { return [pscustomobject]@{ text = Normalize-Whitespace -Value (Get-Content -LiteralPath $Path -Raw); note = "Batch text extracted."; supported = $true } }
        ".js" { return [pscustomobject]@{ text = Normalize-Whitespace -Value (Get-Content -LiteralPath $Path -Raw); note = "JavaScript text extracted."; supported = $true } }
        ".ts" { return [pscustomobject]@{ text = Normalize-Whitespace -Value (Get-Content -LiteralPath $Path -Raw); note = "TypeScript text extracted."; supported = $true } }
        ".tsx" { return [pscustomobject]@{ text = Normalize-Whitespace -Value (Get-Content -LiteralPath $Path -Raw); note = "TypeScript text extracted."; supported = $true } }
        ".cs" { return [pscustomobject]@{ text = Normalize-Whitespace -Value (Get-Content -LiteralPath $Path -Raw); note = "C# text extracted."; supported = $true } }
        ".java" { return [pscustomobject]@{ text = Normalize-Whitespace -Value (Get-Content -LiteralPath $Path -Raw); note = "Java text extracted."; supported = $true } }
        ".py" { return [pscustomobject]@{ text = Normalize-Whitespace -Value (Get-Content -LiteralPath $Path -Raw); note = "Python text extracted."; supported = $true } }
        ".sh" { return [pscustomobject]@{ text = Normalize-Whitespace -Value (Get-Content -LiteralPath $Path -Raw); note = "Shell text extracted."; supported = $true } }
        ".json" {
            try {
                $json = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json -Depth 50 | ConvertTo-Json -Depth 50
                return [pscustomobject]@{ text = Normalize-Whitespace -Value $json; note = "JSON text extracted."; supported = $true }
            }
            catch {
                return [pscustomobject]@{ text = Normalize-Whitespace -Value (Get-Content -LiteralPath $Path -Raw); note = "JSON could not be re-formatted, so raw text was returned."; supported = $true }
            }
        }
        ".xml" {
            try {
                $xml = New-Object System.Xml.XmlDocument
                $xml.Load($Path)
                return [pscustomobject]@{ text = Normalize-Whitespace -Value $xml.OuterXml; note = "XML text extracted."; supported = $true }
            }
            catch {
                return [pscustomobject]@{ text = Normalize-Whitespace -Value (Get-Content -LiteralPath $Path -Raw); note = "XML could not be parsed cleanly, so raw text was returned."; supported = $true }
            }
        }
        ".html" { return [pscustomobject]@{ text = Normalize-HtmlFragmentToText -Html (Get-Content -LiteralPath $Path -Raw); note = "HTML text extracted."; supported = $true } }
        ".htm" { return [pscustomobject]@{ text = Normalize-HtmlFragmentToText -Html (Get-Content -LiteralPath $Path -Raw); note = "HTML text extracted."; supported = $true } }
        ".zip" {
            Add-Type -AssemblyName System.IO.Compression.FileSystem
            $archive = [System.IO.Compression.ZipFile]::OpenRead($Path)
            try {
                $pieces = @()
                foreach ($entry in @($archive.Entries | Select-Object -First 8)) {
                    if ([string]::IsNullOrWhiteSpace($entry.Name)) {
                        continue
                    }

                    $converted = Convert-ZipEntryToText -Entry $entry
                    if (-not [string]::IsNullOrWhiteSpace($converted.text)) {
                        $pieces += "### $($converted.name)`n$($converted.text)"
                    }
                }

                return [pscustomobject]@{
                    text = Normalize-Whitespace -Value ($pieces -join "`n`n")
                    note = "Text was extracted from supported files inside the archive."
                    supported = $true
                }
            }
            finally {
                $archive.Dispose()
            }
        }
        ".docx" {
            Add-Type -AssemblyName System.IO.Compression.FileSystem
            $archive = [System.IO.Compression.ZipFile]::OpenRead($Path)
            try {
                $entries = @($archive.Entries | Where-Object {
                        $_.FullName -eq "word/document.xml" -or
                        $_.FullName -like "word/header*.xml" -or
                        $_.FullName -like "word/footer*.xml"
                    })
                if ($entries.Count -eq 0) {
                    return [pscustomobject]@{ text = ""; note = "The DOCX file did not contain word/document.xml."; supported = $false }
                }

                $pieces = New-Object 'System.Collections.Generic.List[string]'
                foreach ($entry in $entries) {
                    $stream = $entry.Open()
                    try {
                        $reader = New-Object System.IO.StreamReader($stream)
                        $xmlText = $reader.ReadToEnd()
                    }
                    finally {
                        if ($reader) {
                            $reader.Dispose()
                        }
                        $stream.Dispose()
                    }

                    $docText = Convert-WordprocessingXmlToText -XmlText $xmlText
                    if (-not [string]::IsNullOrWhiteSpace($docText)) {
                        $pieces.Add($docText)
                    }
                }

                return [pscustomobject]@{ text = Normalize-Whitespace -Value (($pieces.ToArray()) -join "`n`n"); note = "DOCX body text extracted."; supported = ($pieces.Count -gt 0) }
            }
            finally {
                $archive.Dispose()
            }
        }
        ".pdf" {
            $pdf = Convert-PdfBytesToText -Bytes ([System.IO.File]::ReadAllBytes($Path))
            return [pscustomobject]@{ text = $pdf.text; note = $pdf.note; supported = -not [string]::IsNullOrWhiteSpace($pdf.text) }
        }
        ".png" { $ocr = Invoke-OptionalImageOcr -Path $Path; return [pscustomobject]@{ text = $ocr.text; note = $ocr.note; supported = -not [string]::IsNullOrWhiteSpace($ocr.text); ocrUsed = $ocr.ocrUsed } }
        ".jpg" { $ocr = Invoke-OptionalImageOcr -Path $Path; return [pscustomobject]@{ text = $ocr.text; note = $ocr.note; supported = -not [string]::IsNullOrWhiteSpace($ocr.text); ocrUsed = $ocr.ocrUsed } }
        ".jpeg" { $ocr = Invoke-OptionalImageOcr -Path $Path; return [pscustomobject]@{ text = $ocr.text; note = $ocr.note; supported = -not [string]::IsNullOrWhiteSpace($ocr.text); ocrUsed = $ocr.ocrUsed } }
        ".bmp" { $ocr = Invoke-OptionalImageOcr -Path $Path; return [pscustomobject]@{ text = $ocr.text; note = $ocr.note; supported = -not [string]::IsNullOrWhiteSpace($ocr.text); ocrUsed = $ocr.ocrUsed } }
        default {
            if ($MimeType -like "text/*") {
                return [pscustomobject]@{ text = Normalize-Whitespace -Value (Get-Content -LiteralPath $Path -Raw); note = "Text was extracted using the MIME type fallback."; supported = $true }
            }

            return [pscustomobject]@{
                text = ""
                note = "This attachment type is not supported by the built-in text extractor yet."
                supported = $false
            }
        }
    }
}

function Get-JiraAttachmentTextInternal {
    param(
        [Parameter(Mandatory = $true)]
        $Backend,
        [Parameter(Mandatory = $true)]
        $Attachment,
        [int]$MaxBytes = 20971520
    )

    $attachmentId = if ($Attachment.id) { [string]$Attachment.id } else { "" }
    $cacheKey = "{0}|{1}" -f $Backend.Name, $attachmentId
    if ($script:CodexMgxAttachmentCache.ContainsKey($cacheKey)) {
        return $script:CodexMgxAttachmentCache[$cacheKey]
    }

    $size = if ($Attachment.size) { [int]$Attachment.size } else { 0 }
    if ($size -gt $MaxBytes) {
        $largeResult = [pscustomobject]@{
            attachment = $Attachment
            text = ""
            preview = ""
            supported = $false
            note = "Skipped because the attachment is larger than the supported download limit."
            ocrUsed = $false
        }
        $script:CodexMgxAttachmentCache[$cacheKey] = $largeResult
        return $largeResult
    }

    $fileName = if ($Attachment.fileName) { [string]$Attachment.fileName } elseif ($Attachment.filename) { [string]$Attachment.filename } else { "attachment.bin" }
    $contentUrl = if ($Attachment.contentUrl) { [string]$Attachment.contentUrl } elseif ($Attachment.content) { [string]$Attachment.content } else { "" }
    if ([string]::IsNullOrWhiteSpace($contentUrl)) {
        throw "Attachment $fileName does not expose a downloadable content URL."
    }

    $extension = [System.IO.Path]::GetExtension($fileName)
    $tempPath = Join-Path (Get-CodexMgxTempRoot) ("$attachmentId$extension")
    if (-not (Test-Path -LiteralPath $tempPath)) {
        Invoke-BackendDownload -Backend $Backend -Uri $contentUrl -OutputPath $tempPath
    }

    $attachmentMimeType = if ($Attachment.mimeType) { [string]$Attachment.mimeType } else { "" }
    $extracted = Get-ExtractedTextFromFile -Path $tempPath -FileName $fileName -MimeType $attachmentMimeType
    $result = [pscustomobject]@{
        attachment = $Attachment
        text = if ($extracted.text) { [string]$extracted.text } else { "" }
        preview = Get-PlainTextPreview -Text $extracted.text -MaxLength 320
        supported = if ($null -ne $extracted.supported) { [bool]$extracted.supported } else { $false }
        note = if ($extracted.note) { [string]$extracted.note } else { "" }
        ocrUsed = if ($null -ne $extracted.ocrUsed) { [bool]$extracted.ocrUsed } else { $false }
    }

    $script:CodexMgxAttachmentCache[$cacheKey] = $result
    return $result
}

function Get-CodexMgxEntitiesFromIssueBundle {
    param(
        [Parameter(Mandatory = $true)]
        $IssueBundle
    )

    $issue = $IssueBundle.issue
    $summary = if ($IssueBundle.summary) { [string]$IssueBundle.summary } else { "" }
    $normalizedSummary = Get-CleanInvestigationSummary -Summary $summary
    $description = if ($IssueBundle.descriptionText) { [string]$IssueBundle.descriptionText } else { "" }
    $commentText = @($IssueBundle.comments | ForEach-Object { $_.text }) -join "`n"
    $attachmentNames = @($IssueBundle.attachments | Where-Object {
            $_.fileName -and $_.fileName -notmatch '\.(png|jpe?g|bmp)$'
        } | ForEach-Object { $_.fileName }) -join "`n"
    $attachmentNameTokens = Get-SearchTokens -Text $attachmentNames -MaxTokens 6
    $combined = @($normalizedSummary, $description, $commentText, $attachmentNameTokens) -join "`n"

    $errorCodes = [regex]::Matches($combined, "(?i)\b(?:ERROR_[A-Z0-9_]+|[A-Z]{2,}(?:[_-][A-Z0-9]{2,}){1,}|#\d+\s+[A-Z_]+)\b") |
        ForEach-Object { $_.Value } |
        Where-Object { $_ -notmatch "^[A-Z]{2,}-\d+$" }

    $issueKeys = [regex]::Matches($combined, "\b[A-Z][A-Z0-9]+-\d+\b") | ForEach-Object { $_.Value }
    $versions = [regex]::Matches($combined, "\b\d{4}r\d\.\d{3}\.\d{3}[A-Za-z]?\b") | ForEach-Object { $_.Value }
    $paths = [regex]::Matches($combined, "(?:[A-Za-z]:\\|\\\\[A-Za-z0-9._$ -]+\\|/[A-Za-z0-9._/\-]+)[^\s`"`']*") | ForEach-Object { $_.Value }
    $summaryTokens = Get-SearchTokens -Text $normalizedSummary -MaxTokens 8
    $detailTokens = Get-SearchTokens -Text @($description, $commentText, $attachmentNames) -MaxTokens 12
    $componentNames = if ($issue.fields -and $issue.fields.components) { @($issue.fields.components | ForEach-Object { $_.name }) } else { @() }
    $labels = if ($issue.fields -and $issue.fields.labels) { @($issue.fields.labels) } else { @() }
    $versionNames = @()
    if ($issue.fields -and $issue.fields.versions) {
        $versionNames += @($issue.fields.versions | ForEach-Object { $_.name })
    }
    if ($issue.fields -and $issue.fields.fixVersions) {
        $versionNames += @($issue.fields.fixVersions | ForEach-Object { $_.name })
    }
    $projectKey = if ($issue.fields -and $issue.fields.project -and $issue.fields.project.key) { [string]$issue.fields.project.key } else { "" }
    $reporter = if ($issue.fields -and $issue.fields.reporter -and $issue.fields.reporter.displayName) { [string]$issue.fields.reporter.displayName } else { "" }

    $phrases = @()
    if (-not [string]::IsNullOrWhiteSpace($normalizedSummary)) {
        $phrases += $normalizedSummary
        if ($summaryTokens.Count -ge 3) {
            $phrases += ($summaryTokens | Select-Object -First 3) -join " "
        }
        if ($summaryTokens.Count -ge 2) {
            $phrases += ($summaryTokens | Select-Object -First 2) -join " "
        }
    }

    return [pscustomobject]@{
        projectKey = $projectKey
        reporter = $reporter
        issueKeys = Get-UniqueStrings -Values $issueKeys
        errorCodes = Get-UniqueStrings -Values $errorCodes
        versions = Get-UniqueStrings -Values @($versions, $versionNames)
        paths = Get-UniqueStrings -Values $paths
        components = Get-UniqueStrings -Values $componentNames
        labels = Get-UniqueStrings -Values $labels
        summaryTokens = Get-UniqueStrings -Values $summaryTokens
        detailTokens = Get-UniqueStrings -Values $detailTokens
        phrases = Get-UniqueStrings -Values $phrases
        topical = Get-UniqueStrings -Values @($issueKeys, $errorCodes, $versions, $paths, $componentNames, $labels, $summaryTokens, $detailTokens, $phrases)
        all = Get-UniqueStrings -Values @($projectKey, $reporter, $issueKeys, $errorCodes, $versions, $paths, $componentNames, $labels, $summaryTokens, $detailTokens, $phrases)
    }
}

function Get-JqlLiteral {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Value
    )

    return "`"" + ($Value.Replace("\", "\\").Replace("`"", "\`"")) + "`""
}

function Get-CaseInsensitiveOverlap {
    param(
        [Parameter()]
        [object[]]$Left,
        [Parameter()]
        [object[]]$Right
    )

    $leftValues = @(Get-UniqueStrings -Values $Left)
    $rightValues = @(Get-UniqueStrings -Values $Right)
    if ($leftValues.Count -eq 0 -or $rightValues.Count -eq 0) {
        return @()
    }

    $rightLookup = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
    foreach ($value in $rightValues) {
        [void]$rightLookup.Add([string]$value)
    }

    $matches = New-Object 'System.Collections.Generic.List[string]'
    foreach ($value in $leftValues) {
        if ($rightLookup.Contains([string]$value)) {
            $matches.Add([string]$value)
        }
    }

    return $matches.ToArray()
}

function Get-RelatedIssueSignals {
    param(
        [Parameter(Mandatory = $true)]
        $Issue,
        [Parameter(Mandatory = $true)]
        $IssueBundle,
        [Parameter(Mandatory = $true)]
        $Entities,
        [string]$Scope = "",
        [string]$Reason = "",
        [string]$ExpandedText = ""
    )

    $currentIssue = $IssueBundle.issue
    $currentProjectKey = if ($currentIssue.fields -and $currentIssue.fields.project -and $currentIssue.fields.project.key) { [string]$currentIssue.fields.project.key } else { "" }
    $candidateProjectKey = if ($Issue.fields -and $Issue.fields.project -and $Issue.fields.project.key) { [string]$Issue.fields.project.key } else { "" }
    $candidateSummary = if ($Issue.fields -and $Issue.fields.summary) { [string]$Issue.fields.summary } else { "" }
    $candidateDescription = if ($Issue.fields -and $Issue.fields.description) { Convert-JiraAdfToText -Value $Issue.fields.description } else { "" }
    $candidateComponents = if ($Issue.fields -and $Issue.fields.components) { @($Issue.fields.components | ForEach-Object { $_.name }) } else { @() }
    $candidateLabels = if ($Issue.fields -and $Issue.fields.labels) { @($Issue.fields.labels) } else { @() }
    $candidateVersions = @()
    if ($Issue.fields -and $Issue.fields.versions) {
        $candidateVersions += @($Issue.fields.versions | ForEach-Object { $_.name })
    }
    if ($Issue.fields -and $Issue.fields.fixVersions) {
        $candidateVersions += @($Issue.fields.fixVersions | ForEach-Object { $_.name })
    }

    $issueType = if ($Issue.fields -and $Issue.fields.issuetype -and $Issue.fields.issuetype.name) { [string]$Issue.fields.issuetype.name } else { "" }
    $currentIssueType = if ($currentIssue.fields -and $currentIssue.fields.issuetype -and $currentIssue.fields.issuetype.name) { [string]$currentIssue.fields.issuetype.name } else { "" }
    $status = if ($Issue.fields -and $Issue.fields.status -and $Issue.fields.status.name) { [string]$Issue.fields.status.name } else { "" }
    $candidateText = Normalize-Whitespace -Value (@($candidateSummary, $candidateDescription, $ExpandedText, $candidateComponents, $candidateLabels, $candidateVersions) -join " ")
    $matchedEntities = @(Get-MatchedEntitiesForText -Text $candidateText -Entities $Entities.topical)
    $sharedComponents = @(Get-CaseInsensitiveOverlap -Left $Entities.components -Right $candidateComponents)
    $sharedLabels = @(Get-CaseInsensitiveOverlap -Left $Entities.labels -Right $candidateLabels)
    $sharedVersions = @(Get-CaseInsensitiveOverlap -Left $Entities.versions -Right $candidateVersions)
    $sharedIssueKeys = @(Get-CaseInsensitiveOverlap -Left $Entities.issueKeys -Right ([regex]::Matches($candidateText, "\b[A-Z][A-Z0-9]+-\d+\b") | ForEach-Object { $_.Value }))
    $sameProject = -not [string]::IsNullOrWhiteSpace($currentProjectKey) -and $currentProjectKey -eq $candidateProjectKey
    $sameIssueType = -not [string]::IsNullOrWhiteSpace($issueType) -and $issueType -eq $currentIssueType
    $summaryPhraseHits = @()
    foreach ($phrase in @($Entities.phrases | Select-Object -First 3)) {
        if (-not [string]::IsNullOrWhiteSpace($phrase) -and $candidateText.IndexOf([string]$phrase, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) {
            $summaryPhraseHits += [string]$phrase
        }
    }

    $score = 0
    $score += ($matchedEntities.Count * 12)
    $score += ($sharedComponents.Count * 11)
    $score += ($sharedLabels.Count * 8)
    $score += ($sharedVersions.Count * 7)
    $score += ($sharedIssueKeys.Count * 9)
    $score += ($summaryPhraseHits.Count * 10)
    if ($sameProject) {
        $score += 9
    }
    if ($sameIssueType) {
        $score += 6
    }
    if ($status -match "Delivered|Closed|Resolved|Done") {
        $score += 10
    }

    switch ($Scope) {
        "linked_issue" { $score += 35 }
        "same_project" { $score += 8 }
        "cross_project" { $score += 4 }
    }

    if ($Reason -match "error-code") {
        $score += 12
    }
    elseif ($Reason -match "summary phrase") {
        $score += 8
    }
    elseif ($Reason -match "component") {
        $score += 7
    }

    $structuralMatches = Get-UniqueStrings -Values @($sharedComponents, $sharedLabels, $sharedVersions, $sharedIssueKeys)
    return [pscustomobject]@{
        score = $score
        matchedEntities = Get-UniqueStrings -Values @($matchedEntities, $structuralMatches, $summaryPhraseHits)
        sharedComponents = $sharedComponents
        sharedLabels = $sharedLabels
        sharedVersions = $sharedVersions
        sharedIssueKeys = $sharedIssueKeys
        summaryPhraseHits = $summaryPhraseHits
        sameProject = $sameProject
        sameIssueType = $sameIssueType
    }
}

function Get-RelatedJqlQueries {
    param(
        [Parameter(Mandatory = $true)]
        $IssueBundle,
        [Parameter(Mandatory = $true)]
        $Entities
    )

    $projectKey = $Entities.projectKey
    $queries = New-Object 'System.Collections.Generic.List[object]'
    $baseOrder = "ORDER BY updated DESC"

    foreach ($errorCode in @($Entities.errorCodes | Select-Object -First 3)) {
        if (-not [string]::IsNullOrWhiteSpace($projectKey)) {
            $queries.Add([pscustomobject]@{
                scope = "same_project"
                query = "project = $projectKey AND text ~ $((Get-JqlLiteral -Value $errorCode)) $baseOrder"
                reason = "Same-project exact error-code match"
            })
        }

        $queries.Add([pscustomobject]@{
            scope = "cross_project"
            query = "text ~ $((Get-JqlLiteral -Value $errorCode)) $baseOrder"
            reason = "Cross-project exact error-code match"
        })
    }

    foreach ($phrase in @($Entities.phrases | Select-Object -First 2)) {
        if ($phrase.Split(" ").Count -lt 2) {
            continue
        }

        if (-not [string]::IsNullOrWhiteSpace($projectKey)) {
            $queries.Add([pscustomobject]@{
                scope = "same_project"
                query = "project = $projectKey AND text ~ $((Get-JqlLiteral -Value $phrase)) $baseOrder"
                reason = "Same-project summary phrase match"
            })
        }

        $queries.Add([pscustomobject]@{
            scope = "cross_project"
            query = "text ~ $((Get-JqlLiteral -Value $phrase)) $baseOrder"
            reason = "Cross-project summary phrase match"
        })
    }

    $tokenPairs = @()
    $tokens = @($Entities.summaryTokens + $Entities.detailTokens | Select-Object -Unique)
    for ($i = 0; $i -lt [Math]::Min($tokens.Count, 5); $i++) {
        for ($j = $i + 1; $j -lt [Math]::Min($tokens.Count, 5); $j++) {
            $tokenPairs += ,@($tokens[$i], $tokens[$j])
        }
    }

    foreach ($pair in @($tokenPairs | Select-Object -First 4)) {
        $termJql = "text ~ $((Get-JqlLiteral -Value $pair[0])) AND text ~ $((Get-JqlLiteral -Value $pair[1]))"
        if (-not [string]::IsNullOrWhiteSpace($projectKey)) {
            $queries.Add([pscustomobject]@{
                scope = "same_project"
                query = "project = $projectKey AND $termJql $baseOrder"
                reason = "Same-project module token pairing"
            })
        }

        $queries.Add([pscustomobject]@{
            scope = "cross_project"
            query = "$termJql $baseOrder"
            reason = "Cross-project module token pairing"
        })
    }

    foreach ($component in @($Entities.components | Select-Object -First 2)) {
        if (-not [string]::IsNullOrWhiteSpace($projectKey)) {
            $queries.Add([pscustomobject]@{
                scope = "same_project"
                query = "project = $projectKey AND component = $((Get-JqlLiteral -Value $component)) $baseOrder"
                reason = "Same-project component match"
            })
        }
    }

    foreach ($label in @($Entities.labels | Select-Object -First 2)) {
        if (-not [string]::IsNullOrWhiteSpace($projectKey)) {
            $queries.Add([pscustomobject]@{
                scope = "same_project"
                query = "project = $projectKey AND labels in ($((Get-JqlLiteral -Value $label))) $baseOrder"
                reason = "Same-project label match"
            })
        }
    }

    foreach ($version in @($Entities.versions | Select-Object -First 2)) {
        if (-not [string]::IsNullOrWhiteSpace($projectKey)) {
            $queries.Add([pscustomobject]@{
                scope = "same_project"
                query = "project = $projectKey AND text ~ $((Get-JqlLiteral -Value $version)) $baseOrder"
                reason = "Same-project version match"
            })
        }
    }

    return $queries |
        Group-Object query |
        ForEach-Object { $_.Group | Select-Object -First 1 }
}

function Search-JiraRelatedIssues {
    param(
        [Parameter(Mandatory = $true)]
        $Backend,
        [Parameter(Mandatory = $true)]
        $IssueBundle,
        [Parameter(Mandatory = $true)]
        $Entities,
        [int]$MaxResults = 20,
        [switch]$IncludeCrossProject
    )

    $currentKey = [string]$IssueBundle.issue.key
    $linkedKeys = @($IssueBundle.linkedIssues | ForEach-Object { if ($_.issue -and $_.issue.key) { [string]$_.issue.key } })
    $queries = Get-RelatedJqlQueries -IssueBundle $IssueBundle -Entities $Entities
    if (-not $IncludeCrossProject) {
        $queries = @($queries | Where-Object { $_.scope -ne "cross_project" })
    }

    $searchWindow = [Math]::Min([Math]::Max($MaxResults * 2, 16), 20)
    $seen = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
    $results = New-Object 'System.Collections.Generic.List[object]'

    foreach ($link in @($IssueBundle.linkedIssues)) {
        if ($null -eq $link.issue -or -not $link.issue.key) {
            continue
        }

        if ($seen.Add([string]$link.issue.key)) {
            $signals = Get-RelatedIssueSignals -Issue $link.issue -IssueBundle $IssueBundle -Entities $Entities -Scope "linked_issue" -Reason ("Direct Jira issue link: " + [string]$link.direction)
            $results.Add([pscustomobject]@{
                scope = "linked_issue"
                reason = "Direct Jira issue link: $([string]$link.direction)"
                query = ""
                issue = $link.issue
                preScore = $signals.score
                matchedEntities = $signals.matchedEntities
                sharedComponents = $signals.sharedComponents
                sharedLabels = $signals.sharedLabels
                sharedVersions = $signals.sharedVersions
                sharedIssueKeys = $signals.sharedIssueKeys
            })
        }
    }

    foreach ($query in @($queries)) {
        $search = Invoke-JiraSearchIssuesOnBackend -Backend $Backend -Jql $query.query -MaxResults $searchWindow -Fields @("summary", "status", "assignee", "priority", "updated", "issuetype", "project", "labels", "components", "fixVersions", "versions", "description")
        foreach ($issue in @($search.issues)) {
            $key = [string]$issue.key
            if ($key -eq $currentKey) {
                continue
            }

            if ($linkedKeys -contains $key) {
                continue
            }

            if ($seen.Add($key)) {
                $signals = Get-RelatedIssueSignals -Issue $issue -IssueBundle $IssueBundle -Entities $Entities -Scope ([string]$query.scope) -Reason ([string]$query.reason)
                $results.Add([pscustomobject]@{
                    scope = [string]$query.scope
                    reason = [string]$query.reason
                    query = [string]$query.query
                    issue = $issue
                    preScore = $signals.score
                    matchedEntities = $signals.matchedEntities
                    sharedComponents = $signals.sharedComponents
                    sharedLabels = $signals.sharedLabels
                    sharedVersions = $signals.sharedVersions
                    sharedIssueKeys = $signals.sharedIssueKeys
                })
            }
        }
    }

    return @(
        $results.ToArray() |
            Sort-Object @{ Expression = "preScore"; Descending = $true }, @{ Expression = { if ($_.issue.fields -and $_.issue.fields.updated) { [datetime]$_.issue.fields.updated } else { [datetime]::MinValue } }; Descending = $true }, @{ Expression = { [string]$_.issue.key }; Descending = $false } |
            Select-Object -First ([Math]::Max($MaxResults * 3, 18))
    )
}

function Get-DocumentationQueries {
    param(
        [Parameter(Mandatory = $true)]
        $Entities
    )

    $queries = New-Object 'System.Collections.Generic.List[string]'
    foreach ($errorCode in @($Entities.errorCodes | Select-Object -First 2)) {
        $queries.Add($errorCode)
    }

    foreach ($phrase in @($Entities.phrases | Select-Object -First 2)) {
        $queries.Add($phrase)
    }

    foreach ($token in @($Entities.summaryTokens | Select-Object -First 4)) {
        $queries.Add($token)
    }

    return Get-UniqueStrings -Values $queries.ToArray() | Select-Object -First 6
}

function Search-ConfluenceDocuments {
    param(
        [Parameter(Mandatory = $true)]
        $Backend,
        [Parameter()]
        [string[]]$Queries,
        [int]$PerQueryLimit = 5
    )

    $results = New-Object 'System.Collections.Generic.List[object]'
    foreach ($query in @($Queries)) {
        if ([string]::IsNullOrWhiteSpace($query)) {
            continue
        }

        try {
            $search = Invoke-ConfluenceSearchContent -Arguments @{
                source = $Backend.Name
                query = $query
                limit = $PerQueryLimit
            }

            foreach ($item in @($search.structuredContent.results)) {
                $results.Add([pscustomobject]@{
                    sourceType = "confluence_search"
                    query = $query
                    item = $item
                    score = 40
                })
            }
        }
        catch {
        }
    }

    return $results.ToArray()
}

function Search-ModDocuments {
    param(
        [Parameter(Mandatory = $true)]
        $Backend,
        [Parameter()]
        [string[]]$Queries,
        [int]$PerQueryLimit = 5
    )

    $results = New-Object 'System.Collections.Generic.List[object]'
    foreach ($query in @($Queries)) {
        if ([string]::IsNullOrWhiteSpace($query)) {
            continue
        }

        try {
            $search = Invoke-ModDocumentationSearch -Arguments @{
                source = $Backend.Name
                query = $query
                limit = $PerQueryLimit
            }

            foreach ($item in @($search.structuredContent.results)) {
                $results.Add([pscustomobject]@{
                    sourceType = "mod_search"
                    query = $query
                    item = $item
                    score = 45
                })
            }
        }
        catch {
        }
    }

    return $results.ToArray()
}

function Search-KnowledgeBaseDocuments {
    param(
        [Parameter(Mandatory = $true)]
        $Backend,
        [Parameter()]
        [string[]]$Queries,
        [int]$PerQueryLimit = 5
    )

    $results = New-Object 'System.Collections.Generic.List[object]'
    foreach ($query in @($Queries)) {
        if ([string]::IsNullOrWhiteSpace($query)) {
            continue
        }

        try {
            $search = Invoke-KnowledgeBaseSearchTopics -Arguments @{
                source = $Backend.Name
                query = $query
                maxResults = $PerQueryLimit
            }

            foreach ($item in @($search.structuredContent.results)) {
                $results.Add([pscustomobject]@{
                    sourceType = "knowledgebase_search"
                    query = $query
                    item = $item
                    score = if ($item.score) { [int]$item.score } else { 35 }
                })
            }
        }
        catch {
        }
    }

    return $results.ToArray()
}

function Get-ConfluenceContentIdFromSearchResult {
    param(
        $Result
    )

    if ($Result.content -and $Result.content.id) {
        return [string]$Result.content.id
    }

    if ($Result.id) {
        return [string]$Result.id
    }

    return ""
}

function Invoke-ConfluenceGetRelatedContentInternal {
    param(
        [Parameter(Mandatory = $true)]
        $Backend,
        [Parameter(Mandatory = $true)]
        [string]$ContentId,
        [int]$Limit = 10
    )

    $result = Invoke-BackendApi -Backend $Backend -Method "GET" -Path "/wiki/rest/api/content/${ContentId}?expand=space,history.lastUpdated,version,body.storage"
    $children = Invoke-BackendApi -Backend $Backend -Method "GET" -Path "/wiki/rest/api/content/${ContentId}/child/page?limit=$Limit"
    $title = if ($result.title) { [string]$result.title } else { "" }
    $spaceKey = if ($result.space -and $result.space.key) { [string]$result.space.key } else { "" }
    $titleTokens = @(Get-SearchTokens -Text $title -MaxTokens 4)
    $similarResults = @()
    if ($titleTokens.Count -ge 2) {
        $query = ($titleTokens | Select-Object -First 4) -join " "
        try {
            $similarSearch = Invoke-ConfluenceSearchContent -Arguments @{
                source = $Backend.Name
                query = $query
                spaceKey = $spaceKey
                limit = $Limit
            }

            $similarResults = @($similarSearch.structuredContent.results | Where-Object {
                (Get-ConfluenceContentIdFromSearchResult -Result $_) -ne $ContentId
            })
        }
        catch {
        }
    }

    return [pscustomobject]@{
        content = $result
        children = @($children.results)
        similar = @($similarResults)
    }
}

function Invoke-KnowledgeBaseExpandRelatedTopicsInternal {
    param(
        [Parameter(Mandatory = $true)]
        $Backend,
        [string]$Query = "",
        [string]$PageUrlOrPath = "",
        [int]$MaxResults = 10
    )

    $resolvedQuery = $Query
    if ([string]::IsNullOrWhiteSpace($resolvedQuery) -and -not [string]::IsNullOrWhiteSpace($PageUrlOrPath)) {
        $page = Invoke-KnowledgeBaseGetPage -Arguments @{
            source = $Backend.Name
            pageUrlOrPath = $PageUrlOrPath
        }

        $resolvedQuery = [string]$page.structuredContent.page.title
    }

    if ([string]::IsNullOrWhiteSpace($resolvedQuery)) {
        throw "Missing required argument: query or pageUrlOrPath"
    }

    $search = Invoke-KnowledgeBaseSearchTopics -Arguments @{
        source = $Backend.Name
        query = $resolvedQuery
        maxResults = [Math]::Max($MaxResults, 8)
    }

    $results = @($search.structuredContent.results)
    if ($results.Count -eq 0) {
        return [pscustomobject]@{
            query = $resolvedQuery
            results = @()
        }
    }

    $top = $results[0]
    $prefix = if ($top.termPath -and $top.termPath -match " > ") {
        (($top.termPath -split " > ")[0..([Math]::Max(($top.termPath -split " > ").Count - 2, 0))] -join " > ").Trim()
    }
    else {
        [string]$top.termPath
    }

    $related = if ([string]::IsNullOrWhiteSpace($prefix)) {
        $results
    }
    else {
        @($results | Where-Object { $_.termPath -like "$prefix*" })
    }

    return [pscustomobject]@{
        query = $resolvedQuery
        anchor = $top
        results = @($related | Select-Object -First $MaxResults)
    }
}

function Get-RelatedIssueEvidenceItems {
    param(
        [Parameter(Mandatory = $true)]
        $Backend,
        [Parameter(Mandatory = $true)]
        $IssueBundle,
        [Parameter(Mandatory = $true)]
        $RelatedResults,
        [Parameter(Mandatory = $true)]
        $Entities,
        [int]$MaxItems = 14
    )

    $items = New-Object 'System.Collections.Generic.List[object]'
    $count = 0
    $deepRescoreCount = 0
    foreach ($related in @($RelatedResults)) {
        $issue = $related.issue
        if ($null -eq $issue) {
            continue
        }

        $status = if ($issue.fields -and $issue.fields.status) { [string]$issue.fields.status.name } else { "" }
        $summary = if ($issue.fields -and $issue.fields.summary) { [string]$issue.fields.summary } else { "" }
        $components = if ($issue.fields -and $issue.fields.components) { @($issue.fields.components | ForEach-Object { $_.name }) } else { @() }
        $labels = if ($issue.fields -and $issue.fields.labels) { @($issue.fields.labels) } else { @() }
        $description = if ($issue.fields -and $issue.fields.description) { Convert-JiraAdfToText -Value $issue.fields.description } else { "" }
        $text = @($summary, $status, $components, $labels, $description) -join " "
        $matched = @(Get-UniqueStrings -Values @($related.matchedEntities, (Get-MatchedEntitiesForText -Text $text -Entities $Entities.topical)))
        $structuralMatches = @(Get-UniqueStrings -Values @($related.sharedComponents, $related.sharedLabels, $related.sharedVersions, $related.sharedIssueKeys))
        if (($matched.Count -lt 2) -and $related.scope -ne "linked_issue" -and $deepRescoreCount -lt [Math]::Max($MaxItems + 2, 8)) {
            try {
                $deepRescoreCount += 1
                $relatedBundle = Get-JiraIssueBundle -Backend $Backend -IssueKey ([string]$issue.key)
                $expandedText = @(
                    $text
                    $relatedBundle.descriptionText
                    @($relatedBundle.comments | Select-Object -First 3 | ForEach-Object { $_.text })
                    @($relatedBundle.worklogs | Select-Object -First 2 | ForEach-Object { $_.comment })
                ) -join " "
                $signals = Get-RelatedIssueSignals -Issue $relatedBundle.issue -IssueBundle $IssueBundle -Entities $Entities -Scope ([string]$related.scope) -Reason ([string]$related.reason) -ExpandedText $expandedText
                $matched = @($signals.matchedEntities)
                $structuralMatches = @(Get-UniqueStrings -Values @($signals.sharedComponents, $signals.sharedLabels, $signals.sharedVersions, $signals.sharedIssueKeys))
                $related.preScore = $signals.score
                $related.matchedEntities = $signals.matchedEntities
                $related.sharedComponents = $signals.sharedComponents
                $related.sharedLabels = $signals.sharedLabels
                $related.sharedVersions = $signals.sharedVersions
                $related.sharedIssueKeys = $signals.sharedIssueKeys
                $text = $expandedText
            }
            catch {
            }
        }

        if ($matched.Count -eq 0 -and $structuralMatches.Count -eq 0 -and $related.scope -ne "linked_issue") {
            continue
        }

        $isHistorical = $related.scope -ne "linked_issue"
        $confidence = if ($matched.Count -gt 0) { 0.72 } elseif ($structuralMatches.Count -gt 0) { 0.58 } else { 0.45 }
        $baseScore = if ($null -ne $related.preScore) { [int]$related.preScore } else { 40 }
        $score = [Math]::Max($baseScore, 40) + ($matched.Count * 6) + ($structuralMatches.Count * 4)
        if ($status -match "Delivered|Closed|Resolved|Done") {
            $score += 12
        }

        $evidenceClass = if ($isHistorical) { "historical_issue" } else { "linked_issue" }
        $items.Add((New-CodexEvidenceItem -Id ("ISSUE-" + [string]$issue.key) -SourceType "jira_issue" -EvidenceClass $evidenceClass -Title ("{0} - {1}" -f [string]$issue.key, $summary) -Url (Get-IssueWebUrl -Backend $Backend -IssueKey ([string]$issue.key)) -SourceLabel $Backend.DisplayName -FetchedBecause ([string]$related.reason) -MatchedEntities $matched -RelevanceScore $score -Confidence $confidence -Claims (Get-TextClaims -Text $text -EvidenceClass $evidenceClass -Entities $matched) -Metadata @{
            scope = $related.scope
            query = $related.query
            status = $status
            preScore = $related.preScore
            sharedComponents = @($related.sharedComponents)
            sharedLabels = @($related.sharedLabels)
            sharedVersions = @($related.sharedVersions)
            sharedIssueKeys = @($related.sharedIssueKeys)
        }))

    }

    return @(
        $items.ToArray() |
            Sort-Object @{ Expression = "relevanceScore"; Descending = $true }, @{ Expression = "title"; Descending = $false } |
            Select-Object -First $MaxItems
    )
}

function Get-CurrentIssueEvidenceItems {
    param(
        [Parameter(Mandatory = $true)]
        $IssueBundle,
        [Parameter(Mandatory = $true)]
        $Entities
    )

    $items = New-Object 'System.Collections.Generic.List[object]'
    $issue = $IssueBundle.issue
    $status = if ($issue.fields -and $issue.fields.status) { [string]$issue.fields.status.name } else { "" }
    $summary = if ($IssueBundle.summary) { [string]$IssueBundle.summary } else { "" }
    $primaryText = @(
        "Issue: $($issue.key)"
        "Summary: $summary"
        "Status: $status"
        ""
        $IssueBundle.descriptionText
    ) -join "`n"

    $items.Add((New-CodexEvidenceItem -Id ("CURRENT-" + [string]$issue.key) -SourceType "jira_issue" -EvidenceClass "current_ticket" -Title ("{0} - {1}" -f [string]$issue.key, $summary) -Url $IssueBundle.issueUrl -SourceLabel $IssueBundle.source.DisplayName -FetchedBecause "Primary Jira issue under investigation" -MatchedEntities $Entities.all -RelevanceScore 100 -Confidence 0.95 -Claims (Get-TextClaims -Text $primaryText -EvidenceClass "current_ticket" -Entities $Entities.all -MaxClaims 4) -Metadata @{
        status = $status
        projectKey = $Entities.projectKey
        reporter = $Entities.reporter
        worklogCount = @($IssueBundle.worklogs).Count
        attachmentCount = @($IssueBundle.attachments).Count
    }))

    foreach ($comment in @($IssueBundle.comments | Select-Object -Last 3)) {
        if ([string]::IsNullOrWhiteSpace($comment.text)) {
            continue
        }

        $matched = Get-MatchedEntitiesForText -Text $comment.text -Entities $Entities.topical
        $items.Add((New-CodexEvidenceItem -Id ("COMMENT-" + [string]$comment.id) -SourceType "jira_comment" -EvidenceClass "comment" -Title ("Comment by {0} on {1}" -f $comment.author, $comment.created) -Url $IssueBundle.issueUrl -SourceLabel $IssueBundle.source.DisplayName -FetchedBecause "Recent issue comment for local confirmation" -MatchedEntities $matched -RelevanceScore (45 + ($matched.Count * 8)) -Confidence 0.65 -Claims (Get-TextClaims -Text $comment.text -EvidenceClass "comment" -Entities $matched) -Metadata @{
            author = $comment.author
            created = $comment.created
        }))
    }

    return $items.ToArray()
}

function Get-AttachmentEvidenceItems {
    param(
        [Parameter(Mandatory = $true)]
        $Backend,
        [Parameter(Mandatory = $true)]
        $IssueBundle,
        [Parameter(Mandatory = $true)]
        $Entities,
        [int]$MaxItems = 5
    )

    $items = New-Object 'System.Collections.Generic.List[object]'
    $count = 0
    foreach ($attachment in @($IssueBundle.attachments | Select-Object -First $MaxItems)) {
        $attachmentText = Get-JiraAttachmentTextInternal -Backend $Backend -Attachment $attachment
        $matched = Get-MatchedEntitiesForText -Text $attachmentText.text -Entities $Entities.topical
        $attachmentConfidence = if ($attachmentText.supported) { 0.7 } else { 0.3 }
        $items.Add((New-CodexEvidenceItem -Id ("ATTACH-" + [string]$attachment.id) -SourceType "jira_attachment" -EvidenceClass "attachment" -Title ([string]$attachment.fileName) -Url ([string]$attachment.contentUrl) -SourceLabel $Backend.DisplayName -FetchedBecause "Attachment deep-read for investigation evidence" -MatchedEntities $matched -RelevanceScore (40 + ($matched.Count * 10)) -Confidence $attachmentConfidence -Claims (Get-TextClaims -Text $attachmentText.text -EvidenceClass "attachment" -Entities $matched) -Metadata @{
            mimeType = $attachment.mimeType
            size = $attachment.size
            supported = $attachmentText.supported
            note = $attachmentText.note
            ocrUsed = $attachmentText.ocrUsed
        }))

        $count += 1
        if ($count -ge $MaxItems) {
            break
        }
    }

    return $items.ToArray()
}

function Get-DocumentationEvidenceItems {
    param(
        [Parameter()]
        $ConfluenceBackend,
        [Parameter()]
        $KnowledgeBaseBackend,
        [Parameter(Mandatory = $true)]
        $Entities,
        [int]$MaxDocs = 6
    )

    if ($MaxDocs -le 0) {
        return @()
    }

    $docQueries = Get-DocumentationQueries -Entities $Entities
    $confluenceResults = @()
    $modResults = @()
    $kbResults = @()
    if ($ConfluenceBackend) {
        $confluenceResults = Search-ConfluenceDocuments -Backend $ConfluenceBackend -Queries $docQueries
        $modResults = Search-ModDocuments -Backend $ConfluenceBackend -Queries $docQueries
    }
    if ($KnowledgeBaseBackend) {
        $kbResults = Search-KnowledgeBaseDocuments -Backend $KnowledgeBaseBackend -Queries $docQueries
    }

    $combined = New-Object 'System.Collections.Generic.List[object]'
    foreach ($candidate in @($confluenceResults + $modResults + $kbResults)) {
        $title = ""
        $url = ""
        $textSeed = ""
        switch ([string]$candidate.sourceType) {
            "knowledgebase_search" {
                $title = [string]$candidate.item.title
                $url = [string]$candidate.item.url
                $textSeed = @($candidate.query, $candidate.item.termPath, $candidate.item.title) -join " "
            }
            default {
                $title = if ($candidate.item.content -and $candidate.item.content.title) { [string]$candidate.item.content.title } else { [string]$candidate.item.title }
                $relativeUrl = if ($candidate.item.url) { [string]$candidate.item.url } elseif ($candidate.item.content -and $candidate.item.content._links -and $candidate.item.content._links.webui) { [string]$candidate.item.content._links.webui } else { "" }
                $url = if ($relativeUrl -match "^https?://") { $relativeUrl } elseif ($relativeUrl) { $ConfluenceBackend.BaseUrl.TrimEnd("/") + $relativeUrl } else { "" }
                $textSeed = @($candidate.query, $title) -join " "
            }
        }

        $matched = Get-MatchedEntitiesForText -Text $textSeed -Entities $Entities.topical
        $combined.Add([pscustomobject]@{
            sourceType = $candidate.sourceType
            title = $title
            url = $url
            query = $candidate.query
            item = $candidate.item
            matched = $matched
            score = [int]$candidate.score + ($matched.Count * 8)
        })
    }

    $ranked = $combined |
        Sort-Object @{ Expression = "score"; Descending = $true }, @{ Expression = "title"; Descending = $false } |
        Group-Object url |
        ForEach-Object { $_.Group | Select-Object -First 1 } |
        Select-Object -First $MaxDocs

    $items = New-Object 'System.Collections.Generic.List[object]'
    foreach ($doc in @($ranked)) {
        switch ([string]$doc.sourceType) {
            "knowledgebase_search" {
                $page = Invoke-KnowledgeBaseGetPage -Arguments @{
                    source = $KnowledgeBaseBackend.Name
                    pageUrlOrPath = [string]$doc.item.url
                }
                $pageText = [string]$page.structuredContent.page.text
                $items.Add((New-CodexEvidenceItem -Id ("DOC-KB-" + [string]([Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($doc.url))).TrimEnd("=")) -SourceType "knowledgebase_page" -EvidenceClass "documentation" -Title [string]$page.structuredContent.page.title -Url [string]$page.structuredContent.page.url -SourceLabel $KnowledgeBaseBackend.DisplayName -FetchedBecause ("KB search query: " + [string]$doc.query) -MatchedEntities $doc.matched -RelevanceScore $doc.score -Confidence 0.72 -Claims (Get-TextClaims -Text $pageText -EvidenceClass "documentation" -Entities $doc.matched) -Metadata @{
                    query = $doc.query
                    termPath = $doc.item.termPath
                    path = $page.structuredContent.page.path
                }))
            }
            "mod_search" {
                $contentId = Get-ConfluenceContentIdFromSearchResult -Result $doc.item
                if ([string]::IsNullOrWhiteSpace($contentId)) {
                    continue
                }

                $page = Invoke-ModDocumentationGetPage -Arguments @{
                    source = $ConfluenceBackend.Name
                    contentId = $contentId
                }
                $pageText = Normalize-HtmlFragmentToText -Html ([string]$page.structuredContent.content.body.storage.value)
                $modUrl = if ($page.structuredContent.content._links -and $page.structuredContent.content._links.webui) { $ConfluenceBackend.BaseUrl.TrimEnd("/") + [string]$page.structuredContent.content._links.webui } else { "" }
                $items.Add((New-CodexEvidenceItem -Id ("DOC-MOD-" + $contentId) -SourceType "mod_page" -EvidenceClass "documentation" -Title [string]$page.structuredContent.content.title -Url $modUrl -SourceLabel $ConfluenceBackend.DisplayName -FetchedBecause ("MOD docs query: " + [string]$doc.query) -MatchedEntities $doc.matched -RelevanceScore $doc.score -Confidence 0.76 -Claims (Get-TextClaims -Text $pageText -EvidenceClass "documentation" -Entities $doc.matched) -Metadata @{
                    query = $doc.query
                    contentId = $contentId
                    source = "mod"
                }))
            }
            default {
                $contentId = Get-ConfluenceContentIdFromSearchResult -Result $doc.item
                if ([string]::IsNullOrWhiteSpace($contentId)) {
                    continue
                }

                $page = Invoke-ConfluenceGetContent -Arguments @{
                    source = $ConfluenceBackend.Name
                    contentId = $contentId
                }
                $pageText = Normalize-HtmlFragmentToText -Html ([string]$page.structuredContent.content.body.storage.value)
                $confluenceUrl = if ($page.structuredContent.content._links -and $page.structuredContent.content._links.webui) { $ConfluenceBackend.BaseUrl.TrimEnd("/") + [string]$page.structuredContent.content._links.webui } else { "" }
                $items.Add((New-CodexEvidenceItem -Id ("DOC-CONF-" + $contentId) -SourceType "confluence_page" -EvidenceClass "documentation" -Title [string]$page.structuredContent.content.title -Url $confluenceUrl -SourceLabel $ConfluenceBackend.DisplayName -FetchedBecause ("Confluence query: " + [string]$doc.query) -MatchedEntities $doc.matched -RelevanceScore $doc.score -Confidence 0.72 -Claims (Get-TextClaims -Text $pageText -EvidenceClass "documentation" -Entities $doc.matched) -Metadata @{
                    query = $doc.query
                    contentId = $contentId
                    source = "confluence"
                }))
            }
        }
    }

    if ($ConfluenceBackend -and $items.Count -gt 0) {
        $topConfluence = @($items | Where-Object { $_.sourceType -in @("confluence_page", "mod_page") } | Select-Object -First 1)
        if ($topConfluence.Count -gt 0) {
            $contentId = if ($topConfluence[0].metadata -and $topConfluence[0].metadata.contentId) { [string]$topConfluence[0].metadata.contentId } else { "" }
            if (-not [string]::IsNullOrWhiteSpace($contentId)) {
                try {
                    $related = Invoke-ConfluenceGetRelatedContentInternal -Backend $ConfluenceBackend -ContentId $contentId -Limit 5
                    foreach ($child in @($related.children | Select-Object -First 3)) {
                        $title = if ($child.title) { [string]$child.title } else { "(untitled)" }
                        $relativeUrl = if ($child._links -and $child._links.webui) { [string]$child._links.webui } else { "" }
                        $fullUrl = if ($relativeUrl) { $ConfluenceBackend.BaseUrl.TrimEnd("/") + $relativeUrl } else { "" }
                        $matched = Get-MatchedEntitiesForText -Text $title -Entities $Entities.topical
                        $items.Add((New-CodexEvidenceItem -Id ("DOC-CHILD-" + [string]$child.id) -SourceType "confluence_related" -EvidenceClass "documentation" -Title $title -Url $fullUrl -SourceLabel $ConfluenceBackend.DisplayName -FetchedBecause "Child page of the strongest matched Confluence document" -MatchedEntities $matched -RelevanceScore (35 + ($matched.Count * 6)) -Confidence 0.58 -Claims (Get-TextClaims -Text $title -EvidenceClass "documentation" -Entities $matched) -Metadata @{
                            parentContentId = $contentId
                            relation = "child_page"
                        }))
                    }
                }
                catch {
                }
            }
        }
    }

    if ($KnowledgeBaseBackend) {
        try {
            $expanded = Invoke-KnowledgeBaseExpandRelatedTopicsInternal -Backend $KnowledgeBaseBackend -Query (Get-UniqueStrings -Values $docQueries | Select-Object -First 1) -MaxResults 4
            foreach ($result in @($expanded.results | Select-Object -First 3)) {
                $matched = Get-MatchedEntitiesForText -Text ([string]$result.title + " " + [string]$result.termPath) -Entities $Entities.topical
                $items.Add((New-CodexEvidenceItem -Id ("DOC-KBREL-" + [string]([Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($result.url))).TrimEnd("=")) -SourceType "knowledgebase_related" -EvidenceClass "documentation" -Title [string]$result.title -Url [string]$result.url -SourceLabel $KnowledgeBaseBackend.DisplayName -FetchedBecause "Related KB topic expansion around the strongest knowledge-base query" -MatchedEntities $matched -RelevanceScore (30 + ($matched.Count * 5) + [int]$result.score) -Confidence 0.56 -Claims (Get-TextClaims -Text ([string]$result.title + " " + [string]$result.termPath) -EvidenceClass "documentation" -Entities $matched) -Metadata @{
                    query = $expanded.query
                    relation = "related_topic"
                    termPath = $result.termPath
                }))
            }
        }
        catch {
        }
    }

    return $items.ToArray()
}

function Add-EvidenceContradictions {
    param(
        [Parameter(Mandatory = $true)]
        [System.Collections.Generic.List[object]]$Evidence
    )

    $items = @($Evidence)
    foreach ($item in $items) {
        $item.contradictions = @()
    }

    $docs = @($items | Where-Object { $_.evidenceClass -eq "documentation" -or $_.evidenceClass -eq "historical_issue" })
    $observed = @($items | Where-Object { $_.evidenceClass -in @("current_ticket", "attachment", "comment") })

    foreach ($left in $observed) {
        $leftText = @($left.extractedClaims | ForEach-Object { $_.text }) -join " "
        foreach ($right in $docs) {
            $shared = @($left.matchedEntities | Where-Object { $right.matchedEntities -contains $_ })
            if ($shared.Count -eq 0) {
                continue
            }

            $rightText = @($right.extractedClaims | ForEach-Object { $_.text }) -join " "
            $observedProblem = $leftText -match "(?i)\b(error|fail|failed|missing|not in sync|does not|cannot|undocumented|wrong|empty|access denied)\b"
            $expectedOrHistorical = $rightText -match "(?i)\b(should|expected|delivered|resolved|duplicat|sync|visible|removed|copied|works|supported)\b"
            if ($observedProblem -and $expectedOrHistorical) {
                $record = [pscustomobject]@{
                    againstEvidenceId = $right.id
                    reason = "Observed behavior overlaps with documentation or historical evidence that implies a different expected outcome."
                    sharedEntities = $shared
                }
                $left.contradictions += $record
            }
        }
    }
}

function Get-InvestigationVerificationChecks {
    param(
        [Parameter(Mandatory = $true)]
        [object[]]$Evidence
    )

    $current = @($Evidence | Where-Object { $_.evidenceClass -eq "current_ticket" })
    $historical = @($Evidence | Where-Object { $_.evidenceClass -eq "historical_issue" })
    $docs = @($Evidence | Where-Object { $_.evidenceClass -eq "documentation" })
    $attachments = @($Evidence | Where-Object { $_.evidenceClass -eq "attachment" -and $_.metadata.supported })
    $comments = @($Evidence | Where-Object { $_.evidenceClass -eq "comment" })

    $checks = @()
    $checks += [pscustomobject]@{
        name = "current_ticket_plus_historical_sibling"
        status = if ($current.Count -gt 0 -and $historical.Count -gt 0) { "verified" } else { "tentative" }
        rationale = "A historical sibling cross-check is available only when the current issue and at least one historical Jira match were both fetched."
    }
    $checks += [pscustomobject]@{
        name = "current_ticket_plus_documentation"
        status = if ($current.Count -gt 0 -and $docs.Count -gt 0) { "verified" } else { "tentative" }
        rationale = "An expected-behavior cross-check is available only when both live issue evidence and product documentation were fetched."
    }
    $checks += [pscustomobject]@{
        name = "attachment_plus_issue_comment"
        status = if ($attachments.Count -gt 0 -and $comments.Count -gt 0) { "verified" } else { "missing_source" }
        rationale = "Attachment/comment confirmation requires both readable attachment text and at least one Jira comment."
    }
    $checks += [pscustomobject]@{
        name = "documentation_plus_delivered_fix_ticket"
        status = if ($docs.Count -gt 0 -and (@($historical | Where-Object { $_.metadata.status -match "Delivered|Closed|Resolved|Done" }).Count -gt 0)) { "verified" } else { "tentative" }
        rationale = "Documentation/fix confirmation requires product docs plus at least one delivered historical Jira match."
    }

    return $checks
}

function Get-InvestigationHypotheses {
    param(
        [Parameter(Mandatory = $true)]
        [object[]]$Evidence,
        [Parameter(Mandatory = $true)]
        $Entities
    )

    $hypotheses = New-Object 'System.Collections.Generic.List[object]'
    $historical = @($Evidence | Where-Object { $_.evidenceClass -eq "historical_issue" })
    $docs = @($Evidence | Where-Object { $_.evidenceClass -eq "documentation" })
    $attachments = @($Evidence | Where-Object { $_.evidenceClass -eq "attachment" -and $_.metadata.supported })
    $contradictions = @($Evidence | Where-Object { @($_.contradictions).Count -gt 0 })

    if ($historical.Count -gt 0) {
        $hypotheses.Add([pscustomobject]@{
            kind = "historical_regression_or_repeat"
            confidence = [Math]::Round([Math]::Min(0.55 + ($historical.Count * 0.06), 0.92), 2)
            rationale = "The issue has overlapping historical Jira matches, which makes a repeat defect, regression family, or previously-seen behavior more likely."
            evidenceIds = @($historical | Select-Object -First 4 -ExpandProperty id)
        })
    }

    if ($docs.Count -gt 0 -and $contradictions.Count -gt 0) {
        $hypotheses.Add([pscustomobject]@{
            kind = "expected_behavior_conflict"
            confidence = [Math]::Round([Math]::Min(0.58 + ($contradictions.Count * 0.07), 0.9), 2)
            rationale = "Current observed evidence overlaps with documentation or previously-delivered behavior that points to a different expected outcome."
            evidenceIds = @($contradictions | Select-Object -First 4 -ExpandProperty id)
        })
    }

    if ($attachments.Count -gt 0) {
        $hypotheses.Add([pscustomobject]@{
            kind = "attachment_backed_signal"
            confidence = 0.68
            rationale = "Readable attachments were available, so the investigation includes non-ticket evidence such as logs, screenshots, or exported payloads."
            evidenceIds = @($attachments | Select-Object -First 3 -ExpandProperty id)
        })
    }

    if ($Entities.errorCodes.Count -gt 0 -or $Entities.paths.Count -gt 0) {
        $hypotheses.Add([pscustomobject]@{
            kind = "environment_or_integration_clue"
            confidence = 0.52
            rationale = "The issue text exposes specific error codes or paths, which often indicates environment, integration, or permissions context that can be cross-checked."
            evidenceIds = @($Evidence | Where-Object { $_.matchedEntities.Count -gt 0 } | Select-Object -First 4 -ExpandProperty id)
        })
    }

    if ($hypotheses.Count -eq 0 -and $docs.Count -gt 0) {
        $hypotheses.Add([pscustomobject]@{
            kind = "documentation_backed_context"
            confidence = 0.48
            rationale = "The investigation found documentation evidence, but the current heuristics did not find a stronger historical or attachment-backed pattern yet."
            evidenceIds = @($docs | Select-Object -First 4 -ExpandProperty id)
        })
    }

    return $hypotheses.ToArray()
}

function Get-InvestigationOpenQuestions {
    param(
        [Parameter(Mandatory = $true)]
        [object[]]$Evidence,
        [Parameter(Mandatory = $true)]
        [object[]]$Verification
    )

    $questions = New-Object 'System.Collections.Generic.List[string]'
    if (@($Evidence | Where-Object { $_.evidenceClass -eq "documentation" }).Count -eq 0) {
        $questions.Add("No strong documentation match was found, so expected behavior may still need manual confirmation.")
    }

    if (@($Evidence | Where-Object { $_.evidenceClass -eq "attachment" -and -not $_.metadata.supported }).Count -gt 0) {
        $questions.Add("Some attachments could not be fully read by the built-in extractor, so there may still be hidden evidence in unsupported file types.")
    }

    foreach ($check in @($Verification | Where-Object { $_.status -ne "verified" })) {
        $questions.Add("Verification gap: $([string]$check.name) remains $([string]$check.status).")
    }

    return Get-UniqueStrings -Values @($questions)
}

function Get-InvestigationNextChecks {
    param(
        [Parameter(Mandatory = $true)]
        [object[]]$Evidence,
        [Parameter(Mandatory = $true)]
        [object[]]$OpenQuestions
    )

    $checks = New-Object 'System.Collections.Generic.List[string]'
    if (@($Evidence | Where-Object { $_.evidenceClass -eq "historical_issue" }).Count -eq 0) {
        $checks.Add("Broaden the Jira search terms manually to include customer vocabulary, module names, and older project aliases.")
    }

    if (@($Evidence | Where-Object { $_.evidenceClass -eq "documentation" }).Count -eq 0) {
        $checks.Add("Search Confluence and MOD docs with narrower product terms or a shorter summary phrase.")
    }

    if (@($Evidence | Where-Object { $_.evidenceClass -eq "attachment" -and -not $_.metadata.supported }).Count -gt 0) {
        $checks.Add("Re-run the attachment inspection with a supported text-based attachment, or optionally install Tesseract if screenshot OCR would help on this machine.")
    }

    if ($OpenQuestions.Count -eq 0) {
        $checks.Add("Validate the strongest hypothesis against the customer reproduction steps or with a focused Jira comment summary.")
    }

    return Get-UniqueStrings -Values @($checks)
}

function Get-CustomerHistoryEvidenceItems {
    param(
        [Parameter(Mandatory = $true)]
        $Backend,
        [Parameter(Mandatory = $true)]
        $IssueBundle,
        [Parameter(Mandatory = $true)]
        $Entities,
        [int]$MaxResults = 10
    )

    $projectKey = $Entities.projectKey
    if ([string]::IsNullOrWhiteSpace($projectKey)) {
        return @()
    }

    $queries = New-Object 'System.Collections.Generic.List[object]'
    $queries.Add([pscustomobject]@{
        query = "project = $projectKey ORDER BY updated DESC"
        reason = "Recent same-customer project history"
    })

    foreach ($phrase in @($Entities.phrases | Select-Object -First 2)) {
        $queries.Add([pscustomobject]@{
            query = "project = $projectKey AND text ~ $((Get-JqlLiteral -Value $phrase)) ORDER BY updated DESC"
            reason = "Same-customer project history with similar phrasing"
        })
    }

    $seen = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
    $currentKey = [string]$IssueBundle.issue.key
    $items = New-Object 'System.Collections.Generic.List[object]'
    foreach ($query in $queries.ToArray()) {
        try {
            $search = Invoke-JiraSearchIssuesOnBackend -Backend $Backend -Jql $query.query -MaxResults $MaxResults -Fields @("summary", "status", "updated", "issuetype", "project", "labels", "components")
            foreach ($issue in @($search.issues)) {
                if ([string]$issue.key -eq $currentKey) {
                    continue
                }

                if (-not $seen.Add([string]$issue.key)) {
                    continue
                }

                $matched = Get-MatchedEntitiesForText -Text (([string]$issue.fields.summary) + " " + ([string]$issue.fields.status.name)) -Entities $Entities.topical
                $items.Add((New-CodexEvidenceItem -Id ("CUST-" + [string]$issue.key) -SourceType "jira_issue" -EvidenceClass "customer_history" -Title ("{0} - {1}" -f [string]$issue.key, [string]$issue.fields.summary) -Url (Get-IssueWebUrl -Backend $Backend -IssueKey ([string]$issue.key)) -SourceLabel $Backend.DisplayName -FetchedBecause ([string]$query.reason) -MatchedEntities $matched -RelevanceScore (42 + ($matched.Count * 7)) -Confidence 0.6 -Claims (Get-TextClaims -Text ([string]$issue.fields.summary) -EvidenceClass "customer_history" -Entities $matched) -Metadata @{
                    query = $query.query
                    status = if ($issue.fields.status) { [string]$issue.fields.status.name } else { "" }
                    projectKey = $projectKey
                }))
            }
        }
        catch {
        }
    }

    return @(
        $items.ToArray() |
            Sort-Object @{ Expression = "relevanceScore"; Descending = $true }, @{ Expression = "title"; Descending = $false } |
            Select-Object -First $MaxResults
    )
}

function Invoke-CodexMgxInvestigation {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Mode,
        [Parameter(Mandatory = $true)]
        $Backend,
        [Parameter(Mandatory = $true)]
        [string]$IssueKey,
        [int]$MaxRelatedIssues = 16,
        [int]$MaxDocs = 6,
        [int]$MaxAttachments = 4,
        [switch]$IncludeCrossProject,
        [switch]$IncludeAttachmentText
    )

    $issueBundle = Get-JiraIssueBundle -Backend $Backend -IssueKey $IssueKey
    $entities = Get-CodexMgxEntitiesFromIssueBundle -IssueBundle $issueBundle
    $evidence = New-Object 'System.Collections.Generic.List[object]'

    foreach ($item in @(Get-CurrentIssueEvidenceItems -IssueBundle $issueBundle -Entities $entities)) {
        $evidence.Add($item)
    }

    if ($IncludeAttachmentText) {
        foreach ($item in @(Get-AttachmentEvidenceItems -Backend $Backend -IssueBundle $issueBundle -Entities $entities -MaxItems $MaxAttachments)) {
            $evidence.Add($item)
        }
    }

    if ($Mode -in @("ticket", "regression_family", "customer_history")) {
        $related = Search-JiraRelatedIssues -Backend $Backend -IssueBundle $issueBundle -Entities $entities -MaxResults $MaxRelatedIssues -IncludeCrossProject:$IncludeCrossProject
        foreach ($item in @(Get-RelatedIssueEvidenceItems -Backend $Backend -IssueBundle $issueBundle -RelatedResults $related -Entities $entities -MaxItems $MaxRelatedIssues)) {
            $evidence.Add($item)
        }
    }

    $confluenceBackend = $null
    $knowledgeBaseBackend = $null
    try {
        $confluenceBackend = @(Get-RequestedBackends -Product "confluence" -Source "auto") | Select-Object -First 1
    }
    catch {
    }

    try {
        $knowledgeBaseBackend = @(Get-RequestedBackends -Product "knowledgebase" -Source "auto") | Select-Object -First 1
    }
    catch {
    }

    if ($Mode -in @("ticket", "expected_behavior", "regression_family")) {
        foreach ($item in @(Get-DocumentationEvidenceItems -ConfluenceBackend $confluenceBackend -KnowledgeBaseBackend $knowledgeBaseBackend -Entities $entities -MaxDocs $MaxDocs)) {
            $evidence.Add($item)
        }
    }

    if ($Mode -eq "customer_history") {
        foreach ($item in @(Get-CustomerHistoryEvidenceItems -Backend $Backend -IssueBundle $issueBundle -Entities $entities -MaxResults $MaxRelatedIssues)) {
            $evidence.Add($item)
        }
    }

    Add-EvidenceContradictions -Evidence $evidence
    $evidenceItems = $evidence.ToArray()
    $verification = Get-InvestigationVerificationChecks -Evidence $evidenceItems
    $hypotheses = Get-InvestigationHypotheses -Evidence $evidenceItems -Entities $entities
    $openQuestions = Get-InvestigationOpenQuestions -Evidence $evidenceItems -Verification $verification
    $nextChecks = Get-InvestigationNextChecks -Evidence $evidenceItems -OpenQuestions $openQuestions

    $coverage = [pscustomobject]@{
        currentTicketEvidence = @($evidenceItems | Where-Object { $_.evidenceClass -eq "current_ticket" }).Count
        relatedIssues = @($evidenceItems | Where-Object { $_.evidenceClass -in @("historical_issue", "linked_issue") }).Count
        documentation = @($evidenceItems | Where-Object { $_.evidenceClass -eq "documentation" }).Count
        attachments = @($evidenceItems | Where-Object { $_.evidenceClass -eq "attachment" }).Count
        comments = @($evidenceItems | Where-Object { $_.evidenceClass -eq "comment" }).Count
        customerHistory = @($evidenceItems | Where-Object { $_.evidenceClass -eq "customer_history" }).Count
    }

    $textLines = @(
        "Investigation mode: $Mode"
        "Issue: $IssueKey"
        "Summary: $($issueBundle.summary)"
        "Project: $($entities.projectKey)"
        "Evidence counts:"
        "- Current ticket: $($coverage.currentTicketEvidence)"
        "- Related Jira issues: $($coverage.relatedIssues)"
        "- Documentation: $($coverage.documentation)"
        "- Attachments: $($coverage.attachments)"
        "- Comments: $($coverage.comments)"
        "- Customer history: $($coverage.customerHistory)"
        ""
        "Top hypotheses:"
    )

    foreach ($hypothesis in @($hypotheses | Select-Object -First 4)) {
        $textLines += "- $([string]$hypothesis.kind) ($([string]$hypothesis.confidence)): $([string]$hypothesis.rationale)"
    }

    $textLines += ""
    $textLines += "Verification:"
    foreach ($check in @($verification)) {
        $textLines += "- $([string]$check.name): $([string]$check.status)"
    }

    if ($openQuestions.Count -gt 0) {
        $textLines += ""
        $textLines += "Open questions:"
        foreach ($question in @($openQuestions | Select-Object -First 5)) {
            $textLines += "- $question"
        }
    }

    if ($nextChecks.Count -gt 0) {
        $textLines += ""
        $textLines += "Next checks:"
        foreach ($step in @($nextChecks | Select-Object -First 5)) {
            $textLines += "- $step"
        }
    }

    return @{
        content = @(
            @{
                type = "text"
                text = ($textLines -join "`n")
            }
        )
        structuredContent = @{
            investigation = @{
                mode = $Mode
                generatedAt = (Get-Date).ToString("o")
                primaryIssue = @{
                    key = [string]$issueBundle.issue.key
                    summary = [string]$issueBundle.summary
                    url = [string]$issueBundle.issueUrl
                    status = if ($issueBundle.issue.fields.status) { [string]$issueBundle.issue.fields.status.name } else { "" }
                }
                extractedEntities = $entities
                coverage = $coverage
                evidence = $evidenceItems
                verification = @($verification)
                likelyHypotheses = @($hypotheses)
                openQuestions = @($openQuestions)
                recommendedNextChecks = @($nextChecks)
            }
        }
    }
}

function Invoke-JiraGetIssueFull {
    param($Arguments)

    if (-not $Arguments.issueKey) {
        throw "Missing required argument: issueKey"
    }

    $source = if ($Arguments.source) { [string]$Arguments.source } else { "auto" }
    $backend = @(Get-RequestedBackends -Product "jira" -Source $source) | Select-Object -First 1
    if ($null -eq $backend) {
        throw "No Jira backend matched source '$source'."
    }

    $bundle = Get-JiraIssueBundle -Backend $backend -IssueKey ([string]$Arguments.issueKey)
    $attachmentTexts = @()
    if ($Arguments.includeAttachmentText) {
        $limit = if ($Arguments.attachmentLimit) { [int]$Arguments.attachmentLimit } else { 4 }
        foreach ($attachment in @($bundle.attachments | Select-Object -First $limit)) {
            $attachmentTexts += Get-JiraAttachmentTextInternal -Backend $backend -Attachment $attachment
        }
    }

    $summaryLines = @(
        "Source: $($backend.DisplayName)"
        "Issue: $($bundle.issue.key)"
        "Summary: $($bundle.summary)"
        "Comments: $(@($bundle.comments).Count)"
        "Changelog entries: $(@($bundle.changelog).Count)"
        "Worklogs: $(@($bundle.worklogs).Count)"
        "Remote links: $(@($bundle.remoteLinks).Count)"
        "Attachments: $(@($bundle.attachments).Count)"
        "Project components: $(@($bundle.projectContext.components).Count)"
        "Project versions: $(@($bundle.projectContext.versions).Count)"
        "Boards: $(@($bundle.agileContext.boards).Count)"
    )

    return @{
        content = @(
            @{
                type = "text"
                text = ($summaryLines -join "`n")
            }
        )
        structuredContent = @{
            source = $backend | Select-Object Name, DisplayName, Product, BaseUrl
            issueBundle = @{
                issue = $bundle.issue
                issueUrl = $bundle.issueUrl
                summary = $bundle.summary
                descriptionText = $bundle.descriptionText
                comments = $bundle.comments
                changelog = $bundle.changelog
                worklogs = $bundle.worklogs
                remoteLinks = $bundle.remoteLinks
                attachments = $bundle.attachments
                attachmentTexts = $attachmentTexts
                linkedIssues = $bundle.linkedIssues
                projectContext = $bundle.projectContext
                agileContext = $bundle.agileContext
            }
        }
    }
}

function Invoke-JiraSearchRelatedIssues {
    param($Arguments)

    if (-not $Arguments.issueKey) {
        throw "Missing required argument: issueKey"
    }

    $source = if ($Arguments.source) { [string]$Arguments.source } else { "auto" }
    $backend = @(Get-RequestedBackends -Product "jira" -Source $source) | Select-Object -First 1
    if ($null -eq $backend) {
        throw "No Jira backend matched source '$source'."
    }

    $bundle = Get-JiraIssueBundle -Backend $backend -IssueKey ([string]$Arguments.issueKey)
    $entities = Get-CodexMgxEntitiesFromIssueBundle -IssueBundle $bundle
    $maxResults = if ($Arguments.maxResults) { [int]$Arguments.maxResults } else { 16 }
    $related = Search-JiraRelatedIssues -Backend $backend -IssueBundle $bundle -Entities $entities -MaxResults $maxResults -IncludeCrossProject:([bool]$Arguments.includeCrossProject)
    $lines = @("Related Jira issues for $($bundle.issue.key):")
    foreach ($item in @($related | Select-Object -First $maxResults)) {
        $summary = if ($item.issue.fields.summary) { [string]$item.issue.fields.summary } else { "" }
        $lines += "- [$($item.scope)] $($item.issue.key) - $summary"
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
            issueKey = [string]$bundle.issue.key
            extractedEntities = $entities
            relatedIssues = @($related)
        }
    }
}

function Invoke-JiraGetAttachmentText {
    param($Arguments)

    if (-not $Arguments.issueKey) {
        throw "Missing required argument: issueKey"
    }

    if (-not $Arguments.attachmentId -and -not $Arguments.fileName) {
        throw "Missing required argument: attachmentId or fileName"
    }

    $source = if ($Arguments.source) { [string]$Arguments.source } else { "auto" }
    $backend = @(Get-RequestedBackends -Product "jira" -Source $source) | Select-Object -First 1
    if ($null -eq $backend) {
        throw "No Jira backend matched source '$source'."
    }

    $bundle = Get-JiraIssueBundle -Backend $backend -IssueKey ([string]$Arguments.issueKey)
    $attachment = @($bundle.attachments | Where-Object {
        ($Arguments.attachmentId -and [string]$_.id -eq [string]$Arguments.attachmentId) -or
        ($Arguments.fileName -and [string]$_.fileName -eq [string]$Arguments.fileName)
    } | Select-Object -First 1)

    if ($attachment.Count -eq 0) {
        throw "Attachment was not found on issue $([string]$bundle.issue.key)."
    }

    $text = Get-JiraAttachmentTextInternal -Backend $backend -Attachment $attachment[0]
    return @{
        content = @(
            @{
                type = "text"
                text = @(
                    "Attachment: $($attachment[0].fileName)"
                    "Supported: $($text.supported)"
                    "Note: $($text.note)"
                    ""
                    $text.preview
                ) -join "`n"
            }
        )
        structuredContent = @{
            source = $backend | Select-Object Name, DisplayName, Product, BaseUrl
            attachment = $attachment[0]
            extraction = $text
        }
    }
}

function Invoke-ConfluenceGetRelatedContent {
    param($Arguments)

    if (-not $Arguments.contentId) {
        throw "Missing required argument: contentId"
    }

    $source = if ($Arguments.source) { [string]$Arguments.source } else { "auto" }
    $backend = @(Get-RequestedBackends -Product "confluence" -Source $source) | Select-Object -First 1
    if ($null -eq $backend) {
        throw "No Confluence backend matched source '$source'."
    }

    $limit = if ($Arguments.limit) { [int]$Arguments.limit } else { 10 }
    $related = Invoke-ConfluenceGetRelatedContentInternal -Backend $backend -ContentId ([string]$Arguments.contentId) -Limit $limit
    $lines = @(
        "Confluence related content for contentId $($Arguments.contentId):"
        "- Child pages: $(@($related.children).Count)"
        "- Similar pages: $(@($related.similar).Count)"
    )

    return @{
        content = @(
            @{
                type = "text"
                text = ($lines -join "`n")
            }
        )
        structuredContent = @{
            source = $backend | Select-Object Name, DisplayName, Product, BaseUrl
            related = $related
        }
    }
}

function Invoke-KnowledgeBaseExpandRelatedTopics {
    param($Arguments)

    $source = if ($Arguments.source) { [string]$Arguments.source } else { "auto" }
    $backend = @(Get-RequestedBackends -Product "knowledgebase" -Source $source) | Select-Object -First 1
    if ($null -eq $backend) {
        throw "No knowledge base backend matched source '$source'."
    }

    $maxResults = if ($Arguments.maxResults) { [int]$Arguments.maxResults } else { 10 }
    $query = if ($Arguments.query) { [string]$Arguments.query } else { "" }
    $pageUrlOrPath = if ($Arguments.pageUrlOrPath) { [string]$Arguments.pageUrlOrPath } else { "" }
    $expanded = Invoke-KnowledgeBaseExpandRelatedTopicsInternal -Backend $backend -Query $query -PageUrlOrPath $pageUrlOrPath -MaxResults $maxResults
    $lines = @("Knowledge-base related topics for query: $($expanded.query)")
    foreach ($result in @($expanded.results)) {
        $lines += "- $([string]$result.title) ($([string]$result.termPath))"
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
            relatedTopics = $expanded
        }
    }
}

function Invoke-InvestigateTicket {
    param($Arguments)

    if (-not $Arguments.issueKey) {
        throw "Missing required argument: issueKey"
    }

    $source = if ($Arguments.source) { [string]$Arguments.source } else { "auto" }
    $backend = @(Get-RequestedBackends -Product "jira" -Source $source) | Select-Object -First 1
    if ($null -eq $backend) {
        throw "No Jira backend matched source '$source'."
    }

    $maxRelatedIssues = if ($Arguments.maxRelatedIssues) { [int]$Arguments.maxRelatedIssues } else { 16 }
    $maxDocs = if ($Arguments.maxDocs) { [int]$Arguments.maxDocs } else { 6 }
    $maxAttachments = if ($Arguments.maxAttachments) { [int]$Arguments.maxAttachments } else { 4 }
    return Invoke-CodexMgxInvestigation -Mode "ticket" -Backend $backend -IssueKey ([string]$Arguments.issueKey) -MaxRelatedIssues $maxRelatedIssues -MaxDocs $maxDocs -MaxAttachments $maxAttachments -IncludeCrossProject:([bool]$Arguments.includeCrossProject) -IncludeAttachmentText:([bool]$Arguments.includeAttachmentText)
}

function Invoke-InvestigateRegressionFamily {
    param($Arguments)

    if (-not $Arguments.issueKey) {
        throw "Missing required argument: issueKey"
    }

    $source = if ($Arguments.source) { [string]$Arguments.source } else { "auto" }
    $backend = @(Get-RequestedBackends -Product "jira" -Source $source) | Select-Object -First 1
    if ($null -eq $backend) {
        throw "No Jira backend matched source '$source'."
    }

    $maxRelatedIssues = if ($Arguments.maxRelatedIssues) { [int]$Arguments.maxRelatedIssues } else { 20 }
    $maxDocs = if ($Arguments.maxDocs) { [int]$Arguments.maxDocs } else { 5 }
    $maxAttachments = if ($Arguments.maxAttachments) { [int]$Arguments.maxAttachments } else { 2 }
    return Invoke-CodexMgxInvestigation -Mode "regression_family" -Backend $backend -IssueKey ([string]$Arguments.issueKey) -MaxRelatedIssues $maxRelatedIssues -MaxDocs $maxDocs -MaxAttachments $maxAttachments -IncludeCrossProject:$true -IncludeAttachmentText:([bool]$Arguments.includeAttachmentText)
}

function Invoke-InvestigateExpectedBehavior {
    param($Arguments)

    if (-not $Arguments.issueKey) {
        throw "Missing required argument: issueKey"
    }

    $source = if ($Arguments.source) { [string]$Arguments.source } else { "auto" }
    $backend = @(Get-RequestedBackends -Product "jira" -Source $source) | Select-Object -First 1
    if ($null -eq $backend) {
        throw "No Jira backend matched source '$source'."
    }

    $maxRelatedIssues = if ($Arguments.maxRelatedIssues) { [int]$Arguments.maxRelatedIssues } else { 8 }
    $maxDocs = if ($Arguments.maxDocs) { [int]$Arguments.maxDocs } else { 8 }
    $maxAttachments = if ($Arguments.maxAttachments) { [int]$Arguments.maxAttachments } else { 2 }
    return Invoke-CodexMgxInvestigation -Mode "expected_behavior" -Backend $backend -IssueKey ([string]$Arguments.issueKey) -MaxRelatedIssues $maxRelatedIssues -MaxDocs $maxDocs -MaxAttachments $maxAttachments -IncludeCrossProject:([bool]$Arguments.includeCrossProject) -IncludeAttachmentText:([bool]$Arguments.includeAttachmentText)
}

function Invoke-InvestigateCustomerHistory {
    param($Arguments)

    if (-not $Arguments.issueKey) {
        throw "Missing required argument: issueKey"
    }

    $source = if ($Arguments.source) { [string]$Arguments.source } else { "auto" }
    $backend = @(Get-RequestedBackends -Product "jira" -Source $source) | Select-Object -First 1
    if ($null -eq $backend) {
        throw "No Jira backend matched source '$source'."
    }

    $maxRelatedIssues = if ($Arguments.maxRelatedIssues) { [int]$Arguments.maxRelatedIssues } else { 12 }
    $maxAttachments = if ($Arguments.maxAttachments) { [int]$Arguments.maxAttachments } else { 2 }
    return Invoke-CodexMgxInvestigation -Mode "customer_history" -Backend $backend -IssueKey ([string]$Arguments.issueKey) -MaxRelatedIssues $maxRelatedIssues -MaxDocs 0 -MaxAttachments $maxAttachments -IncludeCrossProject:$false -IncludeAttachmentText:([bool]$Arguments.includeAttachmentText)
}

function Get-CodexMgxInvestigationToolDefinitions {
    return @(
        @{
            name = "jira_get_issue_full"
            description = "Fetch a Jira issue with changelog, comments, worklogs, remote links, attachments, project context, and agile context."
            inputSchema = @{
                type = "object"
                properties = @{
                    source = @{
                        type = "string"
                        enum = @("auto", "cloud")
                        description = "Jira source to use."
                    }
                    issueKey = @{
                        type = "string"
                        description = "Issue key such as PROJ-123."
                    }
                    includeAttachmentText = @{
                        type = "boolean"
                        description = "When true, try to download and extract text from a limited number of attachments."
                    }
                    attachmentLimit = @{
                        type = "integer"
                        minimum = 1
                        maximum = 10
                        description = "Maximum number of attachments to read when includeAttachmentText is enabled."
                    }
                }
                required = @("issueKey")
            }
        }
        @{
            name = "jira_search_related_issues"
            description = "Search linked, same-project, and cross-project Jira issues related to one main issue."
            inputSchema = @{
                type = "object"
                properties = @{
                    source = @{
                        type = "string"
                        enum = @("auto", "cloud")
                        description = "Jira source to use."
                    }
                    issueKey = @{
                        type = "string"
                        description = "Issue key such as PROJ-123."
                    }
                    maxResults = @{
                        type = "integer"
                        minimum = 1
                        maximum = 50
                        description = "Maximum number of related issues to return."
                    }
                    includeCrossProject = @{
                        type = "boolean"
                        description = "When true, also search outside the current project for historical siblings."
                    }
                }
                required = @("issueKey")
            }
        }
        @{
            name = "jira_get_attachment_text"
            description = "Download one Jira attachment and extract readable text from supported file types."
            inputSchema = @{
                type = "object"
                properties = @{
                    source = @{
                        type = "string"
                        enum = @("auto", "cloud")
                        description = "Jira source to use."
                    }
                    issueKey = @{
                        type = "string"
                        description = "Issue key such as PROJ-123."
                    }
                    attachmentId = @{
                        type = "string"
                        description = "Attachment ID from the Jira issue."
                    }
                    fileName = @{
                        type = "string"
                        description = "Attachment filename if the ID is not convenient."
                    }
                }
                required = @("issueKey")
            }
        }
        @{
            name = "confluence_get_related_content"
            description = "Fetch Confluence child pages and title-similar pages related to one content item."
            inputSchema = @{
                type = "object"
                properties = @{
                    source = @{
                        type = "string"
                        enum = @("auto", "cloud", "confluence")
                        description = "Confluence source to use."
                    }
                    contentId = @{
                        type = "string"
                        description = "Confluence content ID."
                    }
                    limit = @{
                        type = "integer"
                        minimum = 1
                        maximum = 20
                        description = "Maximum number of child or similar pages to inspect."
                    }
                }
                required = @("contentId")
            }
        }
        @{
            name = "knowledgebase_expand_related_topics"
            description = "Expand a knowledge-base query into nearby related topics and sibling term paths."
            inputSchema = @{
                type = "object"
                properties = @{
                    source = @{
                        type = "string"
                        enum = @("auto", "knowledgebase")
                        description = "Knowledge-base source to use."
                    }
                    query = @{
                        type = "string"
                        description = "Search phrase to expand into related knowledge-base topics."
                    }
                    pageUrlOrPath = @{
                        type = "string"
                        description = "Optional page URL or relative path used to derive the query from a KB page title."
                    }
                    maxResults = @{
                        type = "integer"
                        minimum = 1
                        maximum = 20
                        description = "Maximum number of related topics to return."
                    }
                }
            }
        }
        @{
            name = "investigate_ticket"
            description = "Run a multi-source investigation for one Jira issue across Jira, Confluence, MOD docs, the knowledge base, comments, and attachments."
            inputSchema = @{
                type = "object"
                properties = @{
                    source = @{
                        type = "string"
                        enum = @("auto", "cloud")
                        description = "Jira source to use."
                    }
                    issueKey = @{
                        type = "string"
                        description = "Issue key such as PROJ-123."
                    }
                    maxRelatedIssues = @{
                        type = "integer"
                        minimum = 1
                        maximum = 30
                        description = "Maximum number of related Jira issues to gather."
                    }
                    maxDocs = @{
                        type = "integer"
                        minimum = 1
                        maximum = 12
                        description = "Maximum number of documentation evidence items to gather."
                    }
                    maxAttachments = @{
                        type = "integer"
                        minimum = 1
                        maximum = 10
                        description = "Maximum number of attachments to read."
                    }
                    includeCrossProject = @{
                        type = "boolean"
                        description = "When true, search cross-project historical siblings."
                    }
                    includeAttachmentText = @{
                        type = "boolean"
                        description = "When true, read a limited number of attachments as part of the investigation."
                    }
                }
                required = @("issueKey")
            }
        }
        @{
            name = "investigate_regression_family"
            description = "Investigate whether one Jira issue belongs to a broader regression family or previously-fixed defect cluster."
            inputSchema = @{
                type = "object"
                properties = @{
                    source = @{
                        type = "string"
                        enum = @("auto", "cloud")
                        description = "Jira source to use."
                    }
                    issueKey = @{
                        type = "string"
                        description = "Issue key such as PROJ-123."
                    }
                    maxRelatedIssues = @{
                        type = "integer"
                        minimum = 1
                        maximum = 40
                        description = "Maximum number of related Jira issues to gather."
                    }
                    maxDocs = @{
                        type = "integer"
                        minimum = 1
                        maximum = 12
                        description = "Maximum number of documentation evidence items to gather."
                    }
                    maxAttachments = @{
                        type = "integer"
                        minimum = 1
                        maximum = 10
                        description = "Maximum number of attachments to read."
                    }
                    includeAttachmentText = @{
                        type = "boolean"
                        description = "When true, read a limited number of attachments as part of the investigation."
                    }
                }
                required = @("issueKey")
            }
        }
        @{
            name = "investigate_expected_behavior"
            description = "Investigate expected behavior for one Jira issue by cross-checking documentation and historical Jira evidence."
            inputSchema = @{
                type = "object"
                properties = @{
                    source = @{
                        type = "string"
                        enum = @("auto", "cloud")
                        description = "Jira source to use."
                    }
                    issueKey = @{
                        type = "string"
                        description = "Issue key such as PROJ-123."
                    }
                    maxRelatedIssues = @{
                        type = "integer"
                        minimum = 1
                        maximum = 20
                        description = "Maximum number of historical Jira issues to gather."
                    }
                    maxDocs = @{
                        type = "integer"
                        minimum = 1
                        maximum = 12
                        description = "Maximum number of documentation evidence items to gather."
                    }
                    maxAttachments = @{
                        type = "integer"
                        minimum = 1
                        maximum = 6
                        description = "Maximum number of attachments to read."
                    }
                    includeCrossProject = @{
                        type = "boolean"
                        description = "When true, include cross-project historical Jira matches."
                    }
                    includeAttachmentText = @{
                        type = "boolean"
                        description = "When true, read a limited number of attachments as part of the investigation."
                    }
                }
                required = @("issueKey")
            }
        }
        @{
            name = "investigate_customer_history"
            description = "Investigate recent and similar same-project customer history around one Jira issue."
            inputSchema = @{
                type = "object"
                properties = @{
                    source = @{
                        type = "string"
                        enum = @("auto", "cloud")
                        description = "Jira source to use."
                    }
                    issueKey = @{
                        type = "string"
                        description = "Issue key such as PROJ-123."
                    }
                    maxRelatedIssues = @{
                        type = "integer"
                        minimum = 1
                        maximum = 25
                        description = "Maximum number of same-project history issues to gather."
                    }
                    maxAttachments = @{
                        type = "integer"
                        minimum = 1
                        maximum = 6
                        description = "Maximum number of attachments to read."
                    }
                    includeAttachmentText = @{
                        type = "boolean"
                        description = "When true, read a limited number of attachments as part of the investigation."
                    }
                }
                required = @("issueKey")
            }
        }
    )
}
