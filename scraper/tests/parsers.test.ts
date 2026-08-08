import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { clean, detectPetPolicy, findRecordArray, idText, toInt, toMoney } from '../src/parsers/util.js';
import { asciiName, displayName, locationSlug, toUf, ufToStateName } from '../src/locations.js';

/**
 * The parsing rules every portal depends on.
 *
 * Each case here is a bug that actually happened, or one the comments in those
 * modules warn about. They share a shape: the wrong answer is not an error, it is
 * a plausible-looking number that quietly excludes half the catalogue.
 */

describe('toMoney', () => {
  it('reads the pt-BR formats the portals actually send', () => {
    // '.' groups thousands and ',' is decimal — reading these the other way round
    // turns R$ 3.200 into R$ 3,20.
    assert.equal(toMoney('R$ 3.200'), 3200);
    assert.equal(toMoney('3.200,00'), 3200);
    assert.equal(toMoney('1.234.567,89'), 1234568);
    assert.equal(toMoney('2500'), 2500);
    assert.equal(toMoney(2500), 2500);
    assert.equal(toMoney(2500.4), 2500);
  });

  it('returns 0 rather than NaN for anything unusable', () => {
    // A NaN price propagates into totalPrice and the listing silently matches no
    // filter at all.
    for (const bad of ['', 'sob consulta', null, undefined, {}]) {
      assert.equal(toMoney(bad), 0, `failed for ${JSON.stringify(bad)}`);
    }
  });
});

describe('toInt', () => {
  it('takes the leading number out of a label', () => {
    assert.equal(toInt('112m²'), 112);
    assert.equal(toInt('3 quartos'), 3);
    assert.equal(toInt(['2', '3']), 2);
    assert.equal(toInt(undefined, 7), 7);
  });
});

describe('idText', () => {
  it('accepts a numeric id', () => {
    // The bug this exists for: QuintoAndar returns `"id": 894855254` as a JSON
    // number, `clean()` only accepts strings, and EVERY listing was dropped.
    assert.equal(idText(894855254), '894855254');
    assert.equal(idText('abc-123'), 'abc-123');
    assert.equal(idText(null), '');
  });
});

describe('clean', () => {
  it('collapses whitespace and caps length', () => {
    assert.equal(clean('  a   b  '), 'a b');
    assert.equal(clean('x'.repeat(500), 10), 'x'.repeat(10));
    assert.equal(clean(42), '');
  });
});

describe('detectPetPolicy', () => {
  it('returns null when nothing is stated', () => {
    // A wrong `false` hides perfectly good listings from anyone filtering on pets,
    // so "unknown" must stay distinguishable from "no".
    assert.equal(detectPetPolicy('apartamento reformado'), null);
  });

  it('reads both directions', () => {
    assert.equal(detectPetPolicy('aceita pet'), true);
    assert.equal(detectPetPolicy('pet friendly'), true);
    assert.equal(detectPetPolicy('não aceita animais'), false);
    assert.equal(detectPetPolicy('nao aceita pet'), false);
  });
});

describe('findRecordArray', () => {
  it('finds listings by shape rather than by path', () => {
    // Hydration payloads get reshaped on every redesign; matching the shape is
    // what makes a parser survive that.
    const payload = { props: { pageProps: { deep: { adList: [{ listing: 1 }, { listing: 2 }] } } } };
    assert.equal(findRecordArray(payload, ['listing'])?.length, 2);
  });

  it('returns null when no array matches', () => {
    assert.equal(findRecordArray({ a: [{ x: 1 }] }, ['listing']), null);
  });

  it('does not hang on a circular payload', () => {
    const node: Record<string, unknown> = { name: 'x' };
    node.self = node;
    assert.equal(findRecordArray(node, ['listing']), null);
  });
});

describe('locations', () => {
  it('folds accents and case into one slug', () => {
    // The bug: a profile saved as "Sao Paulo" matched nothing once the portal
    // returned "São Paulo". Case-insensitivity alone does not handle accents.
    assert.equal(locationSlug('São Paulo'), 'sao-paulo');
    assert.equal(locationSlug('sao paulo'), 'sao-paulo');
    assert.equal(locationSlug('SÃO PAULO'), 'sao-paulo');
    assert.equal(locationSlug('  Água   Verde '), 'agua-verde');
    assert.equal(locationSlug(null), '');
  });

  it('normalises a state to a UF', () => {
    assert.equal(toUf('PR'), 'PR');
    assert.equal(toUf('pr'), 'PR');
    assert.equal(toUf('Paraná'), 'PR');
    assert.equal(toUf('parana'), 'PR');
    assert.equal(toUf('Nowhere'), null);
    assert.equal(toUf(null), null);
  });

  it('maps a UF back to the name the portals build URLs from', () => {
    assert.equal(ufToStateName('SP'), 'São Paulo');
    assert.equal(ufToStateName('XX'), null);
  });

  it('strips accents for the portals that need ASCII', () => {
    // Grupo ZAP's location id is built from unaccented display names.
    assert.equal(asciiName('São Paulo'), 'Sao Paulo');
  });

  it('keeps the portal spelling for display', () => {
    assert.equal(displayName('  são   paulo '), 'são paulo');
  });
});
