<?xml version="1.0" encoding="UTF-8"?>
<StyledLayerDescriptor version="1.0.0"
  xmlns="http://www.opengis.net/sld" xmlns:ogc="http://www.opengis.net/ogc"
  xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.opengis.net/sld http://schemas.opengis.net/sld/1.0.0/StyledLayerDescriptor.xsd">
  <NamedLayer><Name>basemap_railways</Name><UserStyle><Title>basemap_railways</Title><FeatureTypeStyle>
<Rule><Name>rail</Name><MaxScaleDenominator>1500000</MaxScaleDenominator><ogc:Filter><ogc:Or><ogc:PropertyIsEqualTo><ogc:PropertyName>fclass</ogc:PropertyName><ogc:Literal>rail</ogc:Literal></ogc:PropertyIsEqualTo><ogc:PropertyIsEqualTo><ogc:PropertyName>fclass</ogc:PropertyName><ogc:Literal>narrow_gauge</ogc:Literal></ogc:PropertyIsEqualTo><ogc:PropertyIsEqualTo><ogc:PropertyName>fclass</ogc:PropertyName><ogc:Literal>light_rail</ogc:Literal></ogc:PropertyIsEqualTo></ogc:Or></ogc:Filter><LineSymbolizer><Stroke><CssParameter name="stroke">#d0d0d0</CssParameter><CssParameter name="stroke-width">1.0</CssParameter><CssParameter name="stroke-linecap">round</CssParameter><CssParameter name="stroke-dasharray">6 4</CssParameter></Stroke></LineSymbolizer></Rule>
  </FeatureTypeStyle></UserStyle></NamedLayer>
</StyledLayerDescriptor>