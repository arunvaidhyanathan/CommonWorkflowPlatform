// bpmn-moddle / cmmn-moddle / dmn-moddle ship no TypeScript definitions, and
// their export styles differ (bpmn-moddle and dmn-moddle export a named
// factory; cmmn-moddle exports a default factory). Minimal ambient typing so
// the adapters get basic type safety without blocking the build. Element
// internals are intentionally loose since the moddle object model is
// dynamically shaped by the descriptor JSON.
//
// This file has no top-level import/export, so it stays a global ambient
// script — each `declare module` below is a standalone module declaration
// rather than an augmentation of an existing one.

interface GlobalModdleElement {
  $type: string
  id?: string
  [key: string]: unknown
}

interface GlobalModdleFromXmlResult {
  rootElement: GlobalModdleElement
  references: unknown[]
  warnings: unknown[]
  elementsById: Record<string, GlobalModdleElement>
}

interface GlobalModdleToXmlResult {
  xml: string
}

declare module 'bpmn-moddle' {
  export type ModdleElement = GlobalModdleElement
  export type FromXmlResult = GlobalModdleFromXmlResult
  export type ToXmlResult = GlobalModdleToXmlResult

  export class BpmnModdle {
    constructor(packages?: Record<string, unknown>, options?: unknown)
    fromXML(xml: string): Promise<FromXmlResult>
    toXML(
      element: ModdleElement,
      options?: { format?: boolean; preamble?: boolean },
    ): Promise<ToXmlResult>
    create(type: string, attrs?: Record<string, unknown>): ModdleElement
  }
}

declare module 'cmmn-moddle' {
  export type ModdleElement = GlobalModdleElement

  // Unlike bpmn-moddle/dmn-moddle, this package (5.0.0) predates their
  // Promise-based rewrite and still uses Node-style (err, result) callbacks.
  // Confirmed empirically — do not "fix" this to return Promise directly.
  export default class CmmnModdle {
    constructor(packages?: Record<string, unknown>, options?: unknown)
    fromXML(
      xml: string,
      typeName: string,
      done: (err: Error | null, result: ModdleElement, context?: { warnings: unknown[] }) => void,
    ): void
    fromXML(
      xml: string,
      done: (err: Error | null, result: ModdleElement, context?: { warnings: unknown[] }) => void,
    ): void
    toXML(
      element: ModdleElement,
      options: { format?: boolean },
      done: (err: Error | null, xml: string) => void,
    ): void
    create(type: string, attrs?: Record<string, unknown>): ModdleElement
  }
}

declare module 'dmn-moddle' {
  export type ModdleElement = GlobalModdleElement
  export type FromXmlResult = GlobalModdleFromXmlResult
  export type ToXmlResult = GlobalModdleToXmlResult

  export class DmnModdle {
    constructor(packages?: Record<string, unknown>, options?: unknown)
    fromXML(xml: string): Promise<FromXmlResult>
    toXML(
      element: ModdleElement,
      options?: { format?: boolean; preamble?: boolean },
    ): Promise<ToXmlResult>
    create(type: string, attrs?: Record<string, unknown>): ModdleElement
  }
}
