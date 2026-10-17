; Windows installer hooks for the Markdown file associations.
;
; Tauri's NSIS template registers .md and .markdown under the one ProgID name
; `Markdown Document`, and remembers each extension's previous default in a
; `<ProgID>_backup` value so the uninstaller can restore it. Two consequences
; that matter to a reader:
;
;   * Installing Inkfin over an existing Inkfin installation memorises Inkfin's
;     own ProgID as the "previous" default. The uninstall that follows then
;     faithfully restores an association to a ProgID it has just deleted, and
;     every .md and .markdown file afterwards asks which app to open it with.
;   * The `_backup` value is never removed, so it survives the uninstall.
;
; NSIS_HOOK_PREINSTALL runs before the template writes any registry value, so it
; can put the extension back to the default that the *first* installation
; remembered. NSIS_HOOK_POSTUNINSTALL runs after the template has removed its
; registry keys, so it can clear anything that still names the dead ProgID and
; take the backup values with it.

!macro InkfinPreservePreviousDefault extension
  ReadRegStr $0 HKCU "Software\Classes\${extension}" ""
  ; Only a previous Inkfin installation can have left our ProgID in place.
  StrCmp $0 "Markdown Document" 0 inkfin_preserve_done_${extension}
  ; The value the first installation remembered is the reader's real default.
  ReadRegStr $1 HKCU "Software\Classes\${extension}" "Markdown Document_backup"
  StrCmp $1 "" inkfin_preserve_done_${extension}
  StrCmp $1 "Markdown Document" inkfin_preserve_done_${extension}
  WriteRegStr HKCU "Software\Classes\${extension}" "" "$1"
  inkfin_preserve_done_${extension}:
!macroend

!macro InkfinClearDeadAssociation extension
  DeleteRegValue HKCU "Software\Classes\${extension}" "Markdown Document_backup"
  ReadRegStr $0 HKCU "Software\Classes\${extension}" ""
  ; `Markdown Document` no longer exists once the uninstaller has run, so an
  ; extension still naming it has no handler at all.
  StrCmp $0 "Markdown Document" 0 inkfin_clear_done_${extension}
  DeleteRegValue HKCU "Software\Classes\${extension}" ""
  inkfin_clear_done_${extension}:
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro InkfinPreservePreviousDefault ".md"
  !insertmacro InkfinPreservePreviousDefault ".markdown"
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  !insertmacro InkfinClearDeadAssociation ".md"
  !insertmacro InkfinClearDeadAssociation ".markdown"
!macroend
