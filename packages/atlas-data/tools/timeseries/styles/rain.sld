<?xml version="1.0" encoding="UTF-8"?>
<!-- Rainfall in mm. A continuous ramp: 0 is transparent, colours interpolate between the stops,
     values below 0 (nodata is -9999) stay transparent and values above 300 take the last colour. -->
<StyledLayerDescriptor version="1.0.0"
    xmlns="http://www.opengis.net/sld" xmlns:ogc="http://www.opengis.net/ogc"
    xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
    xsi:schemaLocation="http://www.opengis.net/sld http://schemas.opengis.net/sld/1.0.0/StyledLayerDescriptor.xsd">
  <NamedLayer>
    <Name>webatlas_rain</Name>
    <UserStyle>
      <Name>webatlas_rain</Name>
      <Title>Lượng mưa (mm)</Title>
      <FeatureTypeStyle>
        <Rule>
          <RasterSymbolizer>
            <Opacity>1.0</Opacity>
            <ColorMap type="ramp">
              <ColorMapEntry color="#c6dbef" quantity="0" opacity="0" label="0"/>
              <ColorMapEntry color="#c6dbef" quantity="1" label="1"/>
              <ColorMapEntry color="#6baed6" quantity="10" label="10"/>
              <ColorMapEntry color="#2171b5" quantity="50" label="50"/>
              <ColorMapEntry color="#08306b" quantity="100" label="100"/>
              <ColorMapEntry color="#54278f" quantity="200" label="200"/>
              <ColorMapEntry color="#3f007d" quantity="300" label="300"/>
            </ColorMap>
          </RasterSymbolizer>
        </Rule>
      </FeatureTypeStyle>
    </UserStyle>
  </NamedLayer>
</StyledLayerDescriptor>
