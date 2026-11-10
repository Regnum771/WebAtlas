<?xml version="1.0" encoding="UTF-8"?>
<!-- Flood depth in metres. Bands and colours copy DEPTH_BANDS in
     apps/web/src/features/flood-scenario/model/depthColour.ts; keep the two in step.
     Intervals: an entry paints values from the previous quantity up to its own; values below 0
     (nodata is -9999) stay transparent. -->
<StyledLayerDescriptor version="1.0.0"
    xmlns="http://www.opengis.net/sld" xmlns:ogc="http://www.opengis.net/ogc"
    xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
    xsi:schemaLocation="http://www.opengis.net/sld http://schemas.opengis.net/sld/1.0.0/StyledLayerDescriptor.xsd">
  <NamedLayer>
    <Name>webatlas_depth</Name>
    <UserStyle>
      <Name>webatlas_depth</Name>
      <Title>Độ sâu ngập (m)</Title>
      <FeatureTypeStyle>
        <Rule>
          <RasterSymbolizer>
            <Opacity>1.0</Opacity>
            <ColorMap type="intervals">
              <ColorMapEntry color="#000000" quantity="0" opacity="0"/>
              <ColorMapEntry color="#bfe3f5" quantity="0.5" label="&lt; 0,5 m"/>
              <ColorMapEntry color="#74b9e6" quantity="1" label="0,5–1 m"/>
              <ColorMapEntry color="#3a86c8" quantity="2" label="1–2 m"/>
              <ColorMapEntry color="#1c56a0" quantity="3" label="2–3 m"/>
              <ColorMapEntry color="#0b2a6b" quantity="100000" label="≥ 3 m"/>
            </ColorMap>
          </RasterSymbolizer>
        </Rule>
      </FeatureTypeStyle>
    </UserStyle>
  </NamedLayer>
</StyledLayerDescriptor>
