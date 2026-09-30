<?xml version="1.0" encoding="UTF-8"?>
<StyledLayerDescriptor xmlns="http://www.opengis.net/sld" version="1.0.0">
 <NamedLayer><Name>contours_plain</Name><UserStyle>
 <FeatureTypeStyle>
  <Rule>
   <Filter xmlns="http://www.opengis.net/ogc"><PropertyIsEqualTo>
     <PropertyName>is_index</PropertyName><Literal>false</Literal>
   </PropertyIsEqualTo></Filter>
   <LineSymbolizer><Stroke>
     <CssParameter name="stroke">#FFFFFF</CssParameter>
     <CssParameter name="stroke-width">2.0</CssParameter>
     <CssParameter name="stroke-opacity">0.45</CssParameter>
   </Stroke></LineSymbolizer>
  </Rule>
  <Rule>
   <Filter xmlns="http://www.opengis.net/ogc"><PropertyIsEqualTo>
     <PropertyName>is_index</PropertyName><Literal>true</Literal>
   </PropertyIsEqualTo></Filter>
   <LineSymbolizer><Stroke>
     <CssParameter name="stroke">#FFFFFF</CssParameter>
     <CssParameter name="stroke-width">2.6</CssParameter>
     <CssParameter name="stroke-opacity">0.55</CssParameter>
   </Stroke></LineSymbolizer>
  </Rule>
 </FeatureTypeStyle>
 <FeatureTypeStyle>
  <Rule>
   <Filter xmlns="http://www.opengis.net/ogc"><PropertyIsEqualTo>
     <PropertyName>is_index</PropertyName><Literal>false</Literal>
   </PropertyIsEqualTo></Filter>
   <LineSymbolizer><Stroke>
     <CssParameter name="stroke">#9C7A4F</CssParameter>
     <CssParameter name="stroke-width">0.5</CssParameter>
     <CssParameter name="stroke-opacity">0.7</CssParameter>
   </Stroke></LineSymbolizer>
  </Rule>
  <Rule>
   <Filter xmlns="http://www.opengis.net/ogc"><PropertyIsEqualTo>
     <PropertyName>is_index</PropertyName><Literal>true</Literal>
   </PropertyIsEqualTo></Filter>
   <LineSymbolizer><Stroke>
     <CssParameter name="stroke">#8A6534</CssParameter>
     <CssParameter name="stroke-width">1.1</CssParameter>
   </Stroke></LineSymbolizer>
  </Rule>
 </FeatureTypeStyle></UserStyle></NamedLayer>
</StyledLayerDescriptor>
