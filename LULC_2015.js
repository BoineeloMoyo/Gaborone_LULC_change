var shp = ee.FeatureCollection(studyarea);
//Map.addLayer(shp, {}, 'ProjectBoundary');

// Function to mask clouds using the quality band of Landsat 8.
var maskL8 = function (image) {
  var qa = image.select("BQA");
  /// Check that the cloud bit is off.
  // See https://landsat.usgs.gov/collectionqualityband
  var mask = qa.bitwiseAnd(1 << 4).eq(0);
  return image.updateMask(mask);
};

// HSV-based Pan-Sharpening of Landsat 8 TOA images.
var panSharpen = function (image) {
  var rgb = image.select("B4", "B3", "B2");
  var pan = image.select("B8");

  // Convert to HSV, swap in the pan band, and convert back to RGB.
  var huesat = rgb.rgbToHsv().select("hue", "saturation");
  var upres = ee.Image.cat(huesat, pan).hsvToRgb();
  return image.addBands(upres);
};

var visPar = { bands: ["B4", "B3", "B2"], min: 0, max: 0.3, gamma: 1.4 };

Map.centerObject(studyarea, 10);

//*************ADD INDICES TO IMPROVE CLASSIFICATION*****************///
var addIndices = function (image) {
  var ndvi = image.normalizedDifference(["B5", "B4"]).rename(["NDVI"]);
  var ndbi = image.normalizedDifference(["B6", "B5"]).rename(["NDBI"]);
  var ndwi = image.normalizedDifference(["B5", "B6"]).rename(["NDWI"]);
  var bsi = image
    .expression("(( X + Y ) - (A + B)) /(( X + Y ) + (A + B)) ", {
      X: image.select("B6"), //swir1
      Y: image.select("B4"), //red
      A: image.select("B5"), // nir
      B: image.select("B2"), // blue
    })
    .rename("BSI");
  return image.addBands(ndvi).addBands(ndbi).addBands(ndwi).addBands(bsi);
};

var bands = [
  "B2",
  "B3",
  "B4",
  "B5",
  "B6",
  "B7",
  "B8",
  "NDVI",
  "NDBI",
  "NDWI",
  "BSI",
];

// //Merge land cover classifications into one feature class
var newfc = Built_Up.merge(Bare_Soil)
  .merge(Mixed_Grassland)
  .merge(Agricultural_Lands)
  .merge(Dense_Vegetation)
  .merge(Water);

var Img2015 = ee
  .ImageCollection("LANDSAT/LC08/C01/T1_TOA")
  .filterDate("2015-01-01", "2015-02-15")
  .map(maskL8)
  .map(panSharpen)
  .median();

var Im2015 = Img2015.clip(studyarea);

print(Im2015);
Map.addLayer(
  Im2015,
  { bands: ["red", "green", "blue"], max: 0.3 },
  "2015 Pansharpened"
);
print(L8);
Map.addLayer(
  L8,
  {
    bands: ["B4", "B3", "B2"],
    min: 0,
    max: 0.3,
    gamma: 1.4,
  },
  "Gaborone 2020"
);

var composite2015 = addIndices(Im2015);

var points = composite2015
  .select(bands)
  .sampleRegions({
    collection: newfc,
    properties: ["Landcover"],
    scale: 30,
  })
  .randomColumn();

var split = 0.7;
var training = points.filter(ee.Filter.lt("random", split)); //these are the two subsets of the training data
var testing = points.filter(ee.Filter.gte("random", split));

var classifier = ee.Classifier.smileRandomForest(200, 5).train({
  features: training,
  classProperty: "Landcover",
  inputProperties: bands,
});

// //Test the accuracy of the model   Print Confusion Matrix and Overall Accuracy
var confusionMatrix = classifier.confusionMatrix();
print("2015 Confusion matrix: ", confusionMatrix);
print("2015 Training Overall Accuracy: ", confusionMatrix.accuracy());
var kappa = confusionMatrix.kappa();
print(" 2015 Training Kappa", kappa);

var validation = testing.classify(classifier);
var testAccuracy = validation.errorMatrix("Landcover", "classification");
print("2015 Validation Error Matrix RF: ", testAccuracy);
print("2015 Validation Overall Accuracy RF: ", testAccuracy.accuracy());
var kappa = testAccuracy.kappa();
print("2015 Validation Kappa", kappa);

var classified15 = composite2015.select(bands).classify(classifier);

// ******Part 5:Create a legend******///

// //Set position of panel
var legend = ui.Panel({
  style: {
    position: "top-left",
    padding: "8px 15px",
  },
});

//Create legend title
var legendTitle = ui.Label({
  value: "Classification Legend",
  style: {
    fontWeight: "bold",
    fontSize: "18px",
    margin: "0 0 4px 0",
    padding: "0",
  },
});

//Add the title to the panel
legend.add(legendTitle);

//Create and style 1 row of the legend.
var makeRow = function (color, name) {
  var colorBox = ui.Label({
    style: {
      backgroundColor: "#" + color,
      padding: "8px",
      margin: "0 0 4px 0",
    },
  });

  var description = ui.Label({
    value: name,
    style: { margin: "0 0 4px 6px" },
  });

  return ui.Panel({
    widgets: [colorBox, description],
    layout: ui.Panel.Layout.Flow("horizontal"),
  });
};

//Identify palette with the legend colors
var palette = ["42f132", "81485c", "117a17", "54d4ff", "f5deb7", "cbe77e"];

//Identify names within the legend
var names = [
  "Agricultural_Lands",
  "Built_Up",
  "Dense_Vegetation",
  "Water",
  "Bare_Soil",
  "Mixed_Grassland",
];

//Add color and names
for (var i = 0; i < 6; i++) {
  legend.add(makeRow(palette[i], names[i]));
}

//Add legend to map
Map.add(legend);

// ////******Part 6: Display the Final Land Cover Classification and Provide Export Options******
// //////////////////////////////////////////////////////////////////////////////////////////////

//Create palette for the final land cover map classifications
var urbanPalette =
  "<RasterSymbolizer>" +
  ' <ColorMap  type="intervals">' +
  '<ColorMapEntry color="#42f132" quantity="0" label="Agricultural_Lands"/>' +
  '<ColorMapEntry color="#81485c" quantity="1" label="Built_Up"/>' +
  '<ColorMapEntry color="#117a17" quantity="2" label="Dense_Vegetation"/>' +
  '<ColorMapEntry color="#54d4ff" quantity="3" label="Water"/>' +
  '<ColorMapEntry color="#f5deb7" quantity="4" label="Bare_Soil"/>' +
  '<ColorMapEntry color="#cbe77e" quantity="5" label="Mixed_Grassland"/>' +
  "</ColorMap>" +
  "</RasterSymbolizer>";

//Add final map to the display
Map.addLayer(classified15.sldStyle(urbanPalette), {}, "2015 Classification");

//*************************************************************************************************************************************************************************************
//***********CALCULATING AREA BY CLASSES***********////
//Create a 2 band image with the area image and the classified image
// Divide the area image by 1e6 so area results are in Sq Km
var areaImage = ee.Image.pixelArea().divide(1e6).addBands(classified15);

// Calculate Area by Class ****Using a Grouped Reducer***////
var areas = areaImage.reduceRegion({
  reducer: ee.Reducer.sum().group({
    groupField: 1,
    groupName: "Landcover",
  }),
  geometry: studyarea,
  scale: 30,
  tileScale: 6,
  maxPixels: 1e10,
});

var classAreas = ee.List(areas.get("groups"));
//print(classAreas)

var areaChart = ui.Chart.image
  .byClass({
    image: areaImage,
    classBand: "classification",
    region: studyarea,
    scale: 30,
    reducer: ee.Reducer.sum(),
    classLabels: [
      "Agric",
      "BuiltUp",
      "Dense_Veg",
      "Water",
      "Bare",
      "Mixed_Grassland",
    ],
  })
  .setOptions({
    hAxis: { title: "Classes" },
    vAxis: { title: "Area Km^2" },
    title: "Total Area by class in 2015",
    series: {
      0: { color: "#42f132" },
      1: { color: "#81485c" },
      2: { color: "#117a17" },
      3: { color: "#54d4ff" },
      4: { color: "#f5deb7" },
      5: { color: "#cbe77e" },
    },
  });
print(areaChart);

//***Calculate copiable area of each class - Just lazy to type :)***///

// for (var a = 0; a < 6; a++) {

// var x = classified15.eq(a).multiply(ee.Image.pixelArea())
//   var calc = x.reduceRegion({
//     reducer: ee.Reducer.sum(),
//     geometry: studyarea,
//     scale: 30,
//     maxPixels: 1e13
//   });

//   print('2015_ID: ' + a + ' ' + 'in km2', calc,
//   ee.Number(calc.values()
//   .get(0))
//   .divide(1e6));
// }

// //Export the classification result
Export.image.toDrive({
  image: classified15,
  description: "classified2015",
  folder: "EarthEngine",
  region: studyarea,
  scale: 30,
  maxPixels: 1e13,
});
