import type { PropertySource } from '@prisma/client';
import type { Parser } from '../types.js';
import { demoParser } from './demo.js';
import { olxParser } from './olx.js';
import { quintoAndarParser } from './quintoandar.js';
import { vivaRealParser, zapParser } from './grupozap.js';

export const PARSERS: Record<string, Parser> = {
  ZAP: zapParser,
  VIVA_REAL: vivaRealParser,
  QUINTO_ANDAR: quintoAndarParser,
  OLX: olxParser,
  DEMO: demoParser,
};

export function getParser(source: PropertySource): Parser {
  const parser = PARSERS[source];
  if (!parser) throw new Error(`No parser registered for source ${source}`);
  return parser;
}

/** Only OLX needs a real browser; the rest hit JSON endpoints. */
export function needsBrowser(sources: PropertySource[]): boolean {
  return sources.includes('OLX');
}
