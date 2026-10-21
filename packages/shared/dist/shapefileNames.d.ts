/**
 * Shapefile field names: a .dbf field name holds at most 10 characters, and two fields may not
 * share a name whatever their case. The API lists the names an export will cut before the user
 * downloads (the export preview), and the worker renames the fields with exactly this mapping,
 * so both read it from here.
 *
 * Rules, applied to the whole list at once:
 * - a name that fits (at most 10 characters, not yet taken) keeps itself; the first of two names
 *   that differ only in case keeps itself;
 * - any other name is cut to its first 10 characters;
 * - when that is taken, it becomes its first 8 characters, '_' and a counter from 1
 *   (`ten_cong_1`, `ten_cong_2`, ...); a counter of two digits or more takes characters from the
 *   prefix, so the name stays at 10 characters.
 *
 * Names that fit are reserved before any name is cut, so a cut name never takes the name of a
 * field that already fits.
 */
export declare const SHAPEFILE_FIELD_MAX = 10;
export declare function shapefileFieldNames(names: string[]): Array<{
    from: string;
    to: string;
}>;
