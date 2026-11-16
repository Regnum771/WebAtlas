<?xml version="1.0" encoding="UTF-8"?>
<StyledLayerDescriptor version="1.0.0"
  xmlns="http://www.opengis.net/sld" xmlns:ogc="http://www.opengis.net/ogc"
  xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.opengis.net/sld http://schemas.opengis.net/sld/1.0.0/StyledLayerDescriptor.xsd">
  <NamedLayer><Name>basemap_water</Name><UserStyle><Title>basemap_water</Title>
  <FeatureTypeStyle>
<Rule><Name>wetland</Name><MaxScaleDenominator>500000</MaxScaleDenominator><ogc:Filter><ogc:Or><ogc:PropertyIsEqualTo><ogc:PropertyName>fclass</ogc:PropertyName><ogc:Literal>wetland</ogc:Literal></ogc:PropertyIsEqualTo><ogc:PropertyIsEqualTo><ogc:PropertyName>fclass</ogc:PropertyName><ogc:Literal>wetland_marsh</ogc:Literal></ogc:PropertyIsEqualTo><ogc:PropertyIsEqualTo><ogc:PropertyName>fclass</ogc:PropertyName><ogc:Literal>wetland_mangrove</ogc:Literal></ogc:PropertyIsEqualTo><ogc:PropertyIsEqualTo><ogc:PropertyName>fclass</ogc:PropertyName><ogc:Literal>wetland_tidalflat</ogc:Literal></ogc:PropertyIsEqualTo><ogc:PropertyIsEqualTo><ogc:PropertyName>fclass</ogc:PropertyName><ogc:Literal>wetland_reedbed</ogc:Literal></ogc:PropertyIsEqualTo><ogc:PropertyIsEqualTo><ogc:PropertyName>fclass</ogc:PropertyName><ogc:Literal>wetland_swamp</ogc:Literal></ogc:PropertyIsEqualTo><ogc:PropertyIsEqualTo><ogc:PropertyName>fclass</ogc:PropertyName><ogc:Literal>wetland_wet_meadow</ogc:Literal></ogc:PropertyIsEqualTo></ogc:Or></ogc:Filter><PolygonSymbolizer><Fill><CssParameter name="fill">#d4e6dc</CssParameter></Fill></PolygonSymbolizer></Rule>
  </FeatureTypeStyle>
  <FeatureTypeStyle>
<Rule><Name>water</Name><ogc:Filter><ogc:Or><ogc:PropertyIsEqualTo><ogc:PropertyName>fclass</ogc:PropertyName><ogc:Literal>water</ogc:Literal></ogc:PropertyIsEqualTo><ogc:PropertyIsEqualTo><ogc:PropertyName>fclass</ogc:PropertyName><ogc:Literal>reservoir</ogc:Literal></ogc:PropertyIsEqualTo><ogc:PropertyIsEqualTo><ogc:PropertyName>fclass</ogc:PropertyName><ogc:Literal>riverbank</ogc:Literal></ogc:PropertyIsEqualTo><ogc:PropertyIsEqualTo><ogc:PropertyName>fclass</ogc:PropertyName><ogc:Literal>dock</ogc:Literal></ogc:PropertyIsEqualTo></ogc:Or></ogc:Filter><PolygonSymbolizer><Fill><CssParameter name="fill">#aad3df</CssParameter></Fill></PolygonSymbolizer></Rule>
  </FeatureTypeStyle>
  </UserStyle></NamedLayer>
</StyledLayerDescriptor>