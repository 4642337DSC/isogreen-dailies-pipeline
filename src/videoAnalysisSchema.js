import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

var __dirname = path.dirname(fileURLToPath(import.meta.url));
var SCHEMAS_DIR = path.join(__dirname, '..', 'schemas');

var schemaCache = {};

// Schemas are small and static (checked into schemas/), so read+parse once
// per process and reuse - no need for a file watcher or per-call disk read.
export function loadSchema(name) {
  if (!schemaCache[name]) {
    var raw = fs.readFileSync(path.join(SCHEMAS_DIR, name + '.schema.json'), 'utf8');
    schemaCache[name] = JSON.parse(raw);
  }
  return schemaCache[name];
}

function resolveRef(ref, root) {
  // Only local "#/$defs/Foo" refs are used in these schemas - no external
  // or nested-pointer refs to support.
  var key = ref.replace('#/$defs/', '');
  var def = root.$defs && root.$defs[key];
  if (!def) throw new Error('Unresolvable $ref: ' + ref);
  return def;
}

function typeList(schema) {
  return Array.isArray(schema.type) ? schema.type : [schema.type];
}

function matchesType(value, type) {
  if (type === 'null') return value === null;
  if (type === 'string') return typeof value === 'string';
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (type === 'integer') return typeof value === 'number' && Number.isInteger(value);
  if (type === 'boolean') return typeof value === 'boolean';
  if (type === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value);
  if (type === 'array') return Array.isArray(value);
  return true;
}

// A small, purpose-built validator covering the JSON Schema subset actually
// used by schemas/*.schema.json (type incl. nullable unions, required,
// properties, items, enum, minimum/maximum, local $defs/$ref) - not a
// general-purpose engine, so it doesn't pull in a dependency for this.
export function validate(schema, data, root, pathPrefix) {
  root = root || schema;
  pathPrefix = pathPrefix || '$';
  var errors = [];

  if (schema.$ref) {
    return validate(resolveRef(schema.$ref, root), data, root, pathPrefix);
  }

  if (schema.type) {
    var types = typeList(schema);
    var ok = types.some(function (t) { return matchesType(data, t); });
    if (!ok) {
      errors.push(pathPrefix + ': expected type ' + types.join('|') + ', got ' + (data === null ? 'null' : typeof data));
      return errors; // further checks would be meaningless against the wrong type
    }
  }

  if (data === null || data === undefined) return errors;

  if (schema.enum && !schema.enum.includes(data)) {
    errors.push(pathPrefix + ': value "' + data + '" not in enum [' + schema.enum.join(', ') + ']');
  }

  if (typeof data === 'number') {
    if (schema.minimum !== undefined && data < schema.minimum) errors.push(pathPrefix + ': ' + data + ' < minimum ' + schema.minimum);
    if (schema.maximum !== undefined && data > schema.maximum) errors.push(pathPrefix + ': ' + data + ' > maximum ' + schema.maximum);
  }

  if (schema.type === 'object' || (Array.isArray(schema.type) && schema.type.includes('object'))) {
    if (data !== null && typeof data === 'object' && !Array.isArray(data)) {
      (schema.required || []).forEach(function (key) {
        if (!(key in data)) errors.push(pathPrefix + '.' + key + ': missing required property');
      });
      Object.keys(schema.properties || {}).forEach(function (key) {
        if (key in data) {
          errors.push.apply(errors, validate(schema.properties[key], data[key], root, pathPrefix + '.' + key));
        }
      });
    }
  }

  if (schema.type === 'array' && Array.isArray(data) && schema.items) {
    data.forEach(function (item, i) {
      errors.push.apply(errors, validate(schema.items, item, root, pathPrefix + '[' + i + ']'));
    });
  }

  return errors;
}

export function assertValid(schemaName, data) {
  var schema = loadSchema(schemaName);
  var errors = validate(schema, data);
  if (errors.length) {
    throw new Error('Failed ' + schemaName + ' schema validation:\n' + errors.join('\n'));
  }
}

// Gemini's responseSchema only understands a subset of JSON Schema (no
// $ref/$defs, no union "type" arrays - nullable fields use `nullable: true`
// instead). This inlines $refs and rewrites nullable unions so the same
// schema file checked into schemas/ can drive both Gemini's structured
// output and the local `validate()` above.
export function toGeminiSchema(schema, root) {
  root = root || schema;
  if (schema.$ref) return toGeminiSchema(resolveRef(schema.$ref, root), root);

  var out = {};
  var types = schema.type ? typeList(schema) : null;
  var nullable = types && types.includes('null');
  var realType = types ? types.find(function (t) { return t !== 'null'; }) : undefined;

  if (realType) out.type = realType;
  if (nullable) out.nullable = true;
  if (schema.description) out.description = schema.description;
  if (schema.enum) out.enum = schema.enum;
  if (schema.minimum !== undefined) out.minimum = schema.minimum;
  if (schema.maximum !== undefined) out.maximum = schema.maximum;

  if (realType === 'object' || (!realType && schema.properties)) {
    out.type = out.type || 'object';
    if (schema.required) out.required = schema.required;
    if (schema.properties) {
      out.properties = {};
      Object.keys(schema.properties).forEach(function (key) {
        out.properties[key] = toGeminiSchema(schema.properties[key], root);
      });
    }
  }

  if (realType === 'array' && schema.items) {
    out.items = toGeminiSchema(schema.items, root);
  }

  return out;
}
