/** A served feature type replaces the default with the same key; defaults fill the rest. */
export function mergeDictionary(defaults, served) {
    if (!served)
        return defaults;
    const merged = { ...defaults };
    for (const featureType of served)
        merged[featureType.key] = featureType;
    return merged;
}
