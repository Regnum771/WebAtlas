<?xml version="1.0" encoding="UTF-8"?>
<StyledLayerDescriptor xmlns="http://www.opengis.net/sld" version="1.0.0">
 <NamedLayer><Name>contours_labelled</Name><UserStyle>
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
 <Rule>
   <Filter xmlns="http://www.opengis.net/ogc"><PropertyIsEqualTo>
     <PropertyName>is_index</PropertyName><Literal>true</Literal>
   </PropertyIsEqualTo></Filter>
   <!-- Labels from about zoom 9 (GeoServer's 1:1,092,000) in. Farther out they are unreadable, and
        group=yes below does not stop every case of the NullPointerException: some zoom-7 metatiles
        still failed with it, so GWC answered 400 and the layer stayed blank at the opening view. -->
   <MaxScaleDenominator>1500000</MaxScaleDenominator>
   <TextSymbolizer>
    <Label>
     <!-- elevation_m is real (500.0); round() renders it as a whole number (500). -->
     <Function xmlns="http://www.opengis.net/ogc" name="round">
       <PropertyName>elevation_m</PropertyName>
     </Function>
    </Label>
    <Font><CssParameter name="font-size">10</CssParameter></Font>
    <LabelPlacement><LinePlacement/></LabelPlacement>
    <Fill><CssParameter name="fill">#6B4E26</CssParameter></Fill>
    <Halo><Radius>1.5</Radius><Fill><CssParameter name="fill">#FFFFFF</CssParameter></Fill></Halo>
    <VendorOption name="followLine">true</VendorOption>
    <!-- Contours are OGC MultiLineString fragments, not one continuous line per index
         value (same fragmentation basemap's road_label() hits with OSM ways). Without
         group=yes, GWC's 4x4 metatiling renders a 1024x1024 canvas and followLine's
         label-merging step throws NullPointerException on the ungrouped parts:
         "Cannot invoke java.util.List.isEmpty() because merged is null". -->
    <VendorOption name="group">yes</VendorOption>
    <VendorOption name="repeat">300</VendorOption>
    <VendorOption name="maxDisplacement">50</VendorOption>
   </TextSymbolizer>
  </Rule>
 </FeatureTypeStyle></UserStyle></NamedLayer>
</StyledLayerDescriptor>
