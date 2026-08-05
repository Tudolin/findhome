import type { PropertySource } from '@prisma/client';
import type { Parser } from '../types.js';
import { chavesNaMaoParser } from './chavesnamao.js';
import { demoParser } from './demo.js';
import { imovelWebParser } from './imovelweb.js';
import { olxParser } from './olx.js';
import { quintoAndarParser } from './quintoandar.js';
import { vivaRealParser, zapParser } from './grupozap.js';

export const PARSERS: Record<string, Parser> = {
  ZAP: zapParser,
  VIVA_REAL: vivaRealParser,
  QUINTO_ANDAR: quintoAndarParser,
  OLX: olxParser,
  CHAVES_NA_MAO: chavesNaMaoParser,
  IMOVELWEB: imovelWebParser,
  DEMO: demoParser,
};

export function getParser(source: PropertySource): Parser {
  const parser = PARSERS[source];
  if (!parser) throw new Error(`No parser registered for source ${source}`);
  return parser;
}

/**
 * Every source except DEMO can end up needing Chromium: OLX always drives a
 * page, and the JSON parsers fall back to one when their endpoint's bot wall
 * refuses a plain request (see http.ts). Nothing is launched until a parser
 * actually asks for a page, so this is only used for logging.
 */
export function mayNeedBrowser(sources: PropertySource[]): boolean {
  return sources.some((source) => source !== 'DEMO');
}
