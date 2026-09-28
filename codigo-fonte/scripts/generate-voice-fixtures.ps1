param([string]$OutputDirectory = (Join-Path $PSScriptRoot '..\..\validacao\analyze-online-2026-09-27\voice'),[switch]$ActionsOnly)
$voiceEvidence = [System.IO.Path]::GetFullPath($OutputDirectory)
[System.IO.Directory]::CreateDirectory($voiceEvidence) | Out-Null
Add-Type -AssemblyName System.Speech
$voiceSynth = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
 if (-not $ActionsOnly) {
  $voiceSynth.SelectVoice('Microsoft Maria Desktop')
  $voiceSynth.SetOutputToWaveFile((Join-Path $voiceEvidence 'synthetic-pt-BR.wav'))
  $voiceSynth.SpeakSsml('<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="pt-BR"><break time="1500ms"/> &#225;s de espadas, dez de copas <break time="1500ms"/></speak>')
  $voiceSynth.SetOutputToNull()
  $voiceSynth.SelectVoice('Microsoft Zira Desktop')
  $voiceSynth.SetOutputToWaveFile((Join-Path $voiceEvidence 'synthetic-en-US.wav'))
  $voiceSynth.SpeakSsml('<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US"><break time="1500ms"/> ace of spades, ten of hearts <break time="1500ms"/></speak>')
  $voiceSynth.SetOutputToNull()
 }
  $voiceSynth.SelectVoice('Microsoft Maria Desktop')
  $voiceSynth.SetOutputToWaveFile((Join-Path $voiceEvidence 'synthetic-action-pt-BR.wav'))
  $voiceSynth.SpeakSsml('<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="pt-BR"><break time="1500ms"/> eu aumento para dois v&#237;rgula cinco <break time="1500ms"/></speak>')
  $voiceSynth.SetOutputToNull()
  $voiceSynth.SelectVoice('Microsoft Zira Desktop')
  $voiceSynth.SetOutputToWaveFile((Join-Path $voiceEvidence 'synthetic-action-en-US.wav'))
  $voiceSynth.SpeakSsml('<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US"><break time="1500ms"/> I raise to two point five <break time="1500ms"/></speak>')
} finally { $voiceSynth.Dispose() }
