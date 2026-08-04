// Client-side file download helper (Section 5.2 "Export"): triggers a
// browser save-as for text content without any server round trip. Used for
// exporting BPMN/CMMN/DMN XML so definitions can be checked into version
// control outside Supabase.
export function downloadTextFile(filename: string, content: string, mimeType = 'application/xml') {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

const SPEC_EXTENSION: Record<'BPMN' | 'CMMN' | 'DMN', string> = {
  BPMN: 'bpmn',
  CMMN: 'cmmn',
  DMN: 'dmn',
}

/** Builds a version-control-friendly filename: <definitionKey>.<ext>, sanitized. */
export function exportFileName(definitionKey: string, specType: 'BPMN' | 'CMMN' | 'DMN'): string {
  const safeKey = (definitionKey || 'untitled').replace(/[^a-zA-Z0-9_-]/g, '_')
  return `${safeKey}.${SPEC_EXTENSION[specType]}`
}
