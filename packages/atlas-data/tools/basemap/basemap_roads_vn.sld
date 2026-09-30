<?xml version="1.0" encoding="UTF-8"?>
<StyledLayerDescriptor version="1.0.0"
  xmlns="http://www.opengis.net/sld" xmlns:ogc="http://www.opengis.net/ogc"
  xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.opengis.net/sld http://schemas.opengis.net/sld/1.0.0/StyledLayerDescriptor.xsd">
  <NamedLayer><Name>basemap_roads_vn</Name><UserStyle><Title>basemap_roads_vn</Title><FeatureTypeStyle>
<Rule><Name>motorway_casing</Name><ogc:Filter><ogc:Or><ogc:PropertyIsEqualTo><ogc:PropertyName>fclass</ogc:PropertyName><ogc:Literal>motorway</ogc:Literal></ogc:PropertyIsEqualTo><ogc:PropertyIsEqualTo><ogc:PropertyName>fclass</ogc:PropertyName><ogc:Literal>motorway_link</ogc:Literal></ogc:PropertyIsEqualTo></ogc:Or></ogc:Filter><LineSymbolizer><Stroke><CssParameter name="stroke">#d8d8d8</CssParameter><CssParameter name="stroke-width">4.0</CssParameter><CssParameter name="stroke-linecap">round</CssParameter></Stroke></LineSymbolizer></Rule>
<Rule><Name>motorway</Name><ogc:Filter><ogc:Or><ogc:PropertyIsEqualTo><ogc:PropertyName>fclass</ogc:PropertyName><ogc:Literal>motorway</ogc:Literal></ogc:PropertyIsEqualTo><ogc:PropertyIsEqualTo><ogc:PropertyName>fclass</ogc:PropertyName><ogc:Literal>motorway_link</ogc:Literal></ogc:PropertyIsEqualTo></ogc:Or></ogc:Filter><LineSymbolizer><Stroke><CssParameter name="stroke">#fdfdfd</CssParameter><CssParameter name="stroke-width">2.4</CssParameter><CssParameter name="stroke-linecap">round</CssParameter></Stroke></LineSymbolizer></Rule>
<Rule><Name>trunk_casing</Name><MaxScaleDenominator>5000000</MaxScaleDenominator><ogc:Filter><ogc:Or><ogc:PropertyIsEqualTo><ogc:PropertyName>fclass</ogc:PropertyName><ogc:Literal>trunk</ogc:Literal></ogc:PropertyIsEqualTo><ogc:PropertyIsEqualTo><ogc:PropertyName>fclass</ogc:PropertyName><ogc:Literal>trunk_link</ogc:Literal></ogc:PropertyIsEqualTo></ogc:Or></ogc:Filter><LineSymbolizer><Stroke><CssParameter name="stroke">#d8d8d8</CssParameter><CssParameter name="stroke-width">3.0</CssParameter><CssParameter name="stroke-linecap">round</CssParameter></Stroke></LineSymbolizer></Rule>
<Rule><Name>trunk</Name><MaxScaleDenominator>5000000</MaxScaleDenominator><ogc:Filter><ogc:Or><ogc:PropertyIsEqualTo><ogc:PropertyName>fclass</ogc:PropertyName><ogc:Literal>trunk</ogc:Literal></ogc:PropertyIsEqualTo><ogc:PropertyIsEqualTo><ogc:PropertyName>fclass</ogc:PropertyName><ogc:Literal>trunk_link</ogc:Literal></ogc:PropertyIsEqualTo></ogc:Or></ogc:Filter><LineSymbolizer><Stroke><CssParameter name="stroke">#fdfdfd</CssParameter><CssParameter name="stroke-width">1.8</CssParameter><CssParameter name="stroke-linecap">round</CssParameter></Stroke></LineSymbolizer></Rule>
<Rule><Name>primary_casing</Name><MaxScaleDenominator>3000000</MaxScaleDenominator><ogc:Filter><ogc:Or><ogc:PropertyIsEqualTo><ogc:PropertyName>fclass</ogc:PropertyName><ogc:Literal>primary</ogc:Literal></ogc:PropertyIsEqualTo><ogc:PropertyIsEqualTo><ogc:PropertyName>fclass</ogc:PropertyName><ogc:Literal>primary_link</ogc:Literal></ogc:PropertyIsEqualTo></ogc:Or></ogc:Filter><LineSymbolizer><Stroke><CssParameter name="stroke">#d8d8d8</CssParameter><CssParameter name="stroke-width">2.8</CssParameter><CssParameter name="stroke-linecap">round</CssParameter></Stroke></LineSymbolizer></Rule>
<Rule><Name>primary</Name><MaxScaleDenominator>3000000</MaxScaleDenominator><ogc:Filter><ogc:Or><ogc:PropertyIsEqualTo><ogc:PropertyName>fclass</ogc:PropertyName><ogc:Literal>primary</ogc:Literal></ogc:PropertyIsEqualTo><ogc:PropertyIsEqualTo><ogc:PropertyName>fclass</ogc:PropertyName><ogc:Literal>primary_link</ogc:Literal></ogc:PropertyIsEqualTo></ogc:Or></ogc:Filter><LineSymbolizer><Stroke><CssParameter name="stroke">#fdfdfd</CssParameter><CssParameter name="stroke-width">1.7</CssParameter><CssParameter name="stroke-linecap">round</CssParameter></Stroke></LineSymbolizer></Rule>
<Rule><Name>major_label</Name><MaxScaleDenominator>1000000</MaxScaleDenominator><ogc:Filter><ogc:Or><ogc:PropertyIsEqualTo><ogc:PropertyName>fclass</ogc:PropertyName><ogc:Literal>motorway</ogc:Literal></ogc:PropertyIsEqualTo><ogc:PropertyIsEqualTo><ogc:PropertyName>fclass</ogc:PropertyName><ogc:Literal>trunk</ogc:Literal></ogc:PropertyIsEqualTo><ogc:PropertyIsEqualTo><ogc:PropertyName>fclass</ogc:PropertyName><ogc:Literal>primary</ogc:Literal></ogc:PropertyIsEqualTo></ogc:Or></ogc:Filter><TextSymbolizer>
      <Label><ogc:PropertyName>name</ogc:PropertyName></Label>
      <Font><CssParameter name="font-family">Arial</CssParameter>
        <CssParameter name="font-size">11</CssParameter>
        <CssParameter name="font-weight">normal</CssParameter></Font>
      <LabelPlacement><LinePlacement><PerpendicularOffset>0</PerpendicularOffset></LinePlacement></LabelPlacement>
      <Halo><Radius>1.8</Radius><Fill><CssParameter name="fill">#ffffff</CssParameter></Fill></Halo>
      <Fill><CssParameter name="fill">#5b5145</CssParameter></Fill>
      <VendorOption name="followLine">true</VendorOption>
      <VendorOption name="group">yes</VendorOption>
      <VendorOption name="repeat">400</VendorOption>
      <VendorOption name="maxDisplacement">40</VendorOption>
      <VendorOption name="spaceAround">4</VendorOption>
      <VendorOption name="maxAngleDelta">30</VendorOption>
    </TextSymbolizer></Rule>
  </FeatureTypeStyle></UserStyle></NamedLayer>
</StyledLayerDescriptor>