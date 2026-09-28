param([string]$OutputDirectory = (Join-Path $PSScriptRoot '..\..\validacao\voice-quality-2026-09-28\corpus-development'))
$qualityOutput = [System.IO.Path]::GetFullPath($OutputDirectory)
if (Test-Path -LiteralPath $qualityOutput) { throw 'Preserve existing corpus; choose a new directory.' }
New-Item -ItemType Directory -Path $qualityOutput | Out-Null
$qualityRaw = Join-Path $qualityOutput 'raw'
New-Item -ItemType Directory -Path $qualityRaw | Out-Null
$qualityPlanJson = & node -e "process.stdout.write(JSON.stringify(require('./scripts/voice-quality-corpus.cjs').nativeCases(),null,2))"
if ($LASTEXITCODE -ne 0) { throw 'Cannot load fixed corpus plan.' }
[System.IO.File]::WriteAllText((Join-Path $qualityOutput 'plan.json'),($qualityPlanJson -join [Environment]::NewLine),[System.Text.UTF8Encoding]::new($false))
$qualityPlan = ($qualityPlanJson -join [Environment]::NewLine) | ConvertFrom-Json
Add-Type -AssemblyName System.Speech
$qualitySynth = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
 foreach ($qualityCase in $qualityPlan) {
  $qualityVoice = if ($qualityCase.locale -eq 'pt-BR') { 'Microsoft Maria Desktop' } else { 'Microsoft Zira Desktop' }
  $qualitySynth.SelectVoice($qualityVoice)
  $qualitySynth.Rate = if ($null -ne $qualityCase.rate) { [int]$qualityCase.rate } else { 0 }
  for ($qualitySegment = 0; $qualitySegment -lt $qualityCase.segments.Count; $qualitySegment++) {
   $qualityWavePath = Join-Path $qualityRaw ($qualityCase.id + '-' + $qualitySegment + '.wav')
   $qualitySynth.SetOutputToWaveFile($qualityWavePath)
   $qualitySynth.Speak([string]$qualityCase.segments[$qualitySegment].text)
   $qualitySynth.SetOutputToNull()
  }
 }
} finally { $qualitySynth.Dispose() }
& node (Join-Path $PSScriptRoot 'compose-voice-quality-corpus.cjs') $qualityOutput
if ($LASTEXITCODE -ne 0) { throw 'Cannot compose deterministic corpus WAVs.' }
