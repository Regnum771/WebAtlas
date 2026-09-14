<?xml version="1.0" encoding="UTF-8"?>
<StyledLayerDescriptor version="1.0.0"
  xmlns="http://www.opengis.net/sld" xmlns:ogc="http://www.opengis.net/ogc"
  xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.opengis.net/sld http://schemas.opengis.net/sld/1.0.0/StyledLayerDescriptor.xsd">
  <NamedLayer><Name>basemap_places_region</Name><UserStyle><Title>basemap_places_region</Title><FeatureTypeStyle>
<Rule><Name>suburb</Name><MaxScaleDenominator>200000</MaxScaleDenominator><ogc:Filter><ogc:PropertyIsEqualTo><ogc:PropertyName>fclass</ogc:PropertyName><ogc:Literal>suburb</ogc:Literal></ogc:PropertyIsEqualTo></ogc:Filter><TextSymbolizer>
      <Label><ogc:PropertyName>name</ogc:PropertyName></Label>
      <Font><CssParameter name="font-family">Arial</CssParameter>
        <CssParameter name="font-size">10</CssParameter>
        <CssParameter name="font-weight">normal</CssParameter></Font>
      <LabelPlacement><PointPlacement><AnchorPoint>
        <AnchorPointX>0.5</AnchorPointX><AnchorPointY>0.5</AnchorPointY></AnchorPoint>
      </PointPlacement></LabelPlacement>
      <Halo><Radius>1.6</Radius><Fill><CssParameter name="fill">#ffffff</CssParameter></Fill></Halo>
      <Fill><CssParameter name="fill">#7a7a7a</CssParameter></Fill>
      <Priority><ogc:PropertyName>population</ogc:PropertyName></Priority>
      <VendorOption name="autoWrap">70</VendorOption>
      <VendorOption name="spaceAround">6</VendorOption>
    </TextSymbolizer></Rule>
<Rule><Name>village</Name><MaxScaleDenominator>120000</MaxScaleDenominator><ogc:Filter><ogc:PropertyIsEqualTo><ogc:PropertyName>fclass</ogc:PropertyName><ogc:Literal>village</ogc:Literal></ogc:PropertyIsEqualTo></ogc:Filter><TextSymbolizer>
      <Label><ogc:PropertyName>name</ogc:PropertyName></Label>
      <Font><CssParameter name="font-family">Arial</CssParameter>
        <CssParameter name="font-size">10</CssParameter>
        <CssParameter name="font-weight">normal</CssParameter></Font>
      <LabelPlacement><PointPlacement><AnchorPoint>
        <AnchorPointX>0.5</AnchorPointX><AnchorPointY>0.5</AnchorPointY></AnchorPoint>
      </PointPlacement></LabelPlacement>
      <Halo><Radius>1.6</Radius><Fill><CssParameter name="fill">#ffffff</CssParameter></Fill></Halo>
      <Fill><CssParameter name="fill">#7a7a7a</CssParameter></Fill>
      <Priority><ogc:PropertyName>population</ogc:PropertyName></Priority>
      <VendorOption name="autoWrap">70</VendorOption>
      <VendorOption name="spaceAround">6</VendorOption>
    </TextSymbolizer></Rule>
<Rule><Name>hamlet</Name><MaxScaleDenominator>45000</MaxScaleDenominator><ogc:Filter><ogc:PropertyIsEqualTo><ogc:PropertyName>fclass</ogc:PropertyName><ogc:Literal>hamlet</ogc:Literal></ogc:PropertyIsEqualTo></ogc:Filter><TextSymbolizer>
      <Label><ogc:PropertyName>name</ogc:PropertyName></Label>
      <Font><CssParameter name="font-family">Arial</CssParameter>
        <CssParameter name="font-size">9</CssParameter>
        <CssParameter name="font-weight">normal</CssParameter></Font>
      <LabelPlacement><PointPlacement><AnchorPoint>
        <AnchorPointX>0.5</AnchorPointX><AnchorPointY>0.5</AnchorPointY></AnchorPoint>
      </PointPlacement></LabelPlacement>
      <Halo><Radius>1.6</Radius><Fill><CssParameter name="fill">#ffffff</CssParameter></Fill></Halo>
      <Fill><CssParameter name="fill">#7a7a7a</CssParameter></Fill>
      <Priority><ogc:PropertyName>population</ogc:PropertyName></Priority>
      <VendorOption name="autoWrap">70</VendorOption>
      <VendorOption name="spaceAround">6</VendorOption>
    </TextSymbolizer></Rule>
  </FeatureTypeStyle></UserStyle></NamedLayer>
</StyledLayerDescriptor>