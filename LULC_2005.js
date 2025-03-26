var shp = ee.FeatureCollection(studyarea);
Map.addLayer(shp, {}, "ProjectBoundary");

//Create palette for the final land cover map classifications
var urbanPalette =
  "<RasterSymbolizer>" +
  ' <ColorMap  type="intervals">' +
  '<ColorMapEntry color="#42f132" quantity="0" label="Agriculture"/>' +
  '<ColorMapEntry color="#81485c" quantity="1" label="Built_Up"/>' +
  '<ColorMapEntry color="#117a17" quantity="2" label="Dense_Vegetation"/>' +
  '<ColorMapEntry color="#54d4ff" quantity="3" label="Water"/>' +
  '<ColorMapEntry color="#f5deb7" quantity="4" label="Bare_Soil"/>' +
  '<ColorMapEntry color="#cbe77e" quantity="5" label="Mixed_Grassland"/>' +
  "</ColorMap>" +
  "</RasterSymbolizer>";

var VIS_PARAM = {
  bands: ["B3", "B2", "B1"],
  min: 0,
  max: 0.3,
  gamma: 1.4,
};

function renameBand6(image) {
  var bands = ["B1", "B2", "B3", "B4", "B5", "B6_VCID_1", "B7", "B8"];
  var new_bands = ["B1", "B2", "B3", "B4", "B5", "B6", "B7", "B8"];
  return image.select(bands).rename(new_bands);
}

// //Specify the bands to use in the prediction.
var BANDS_L7 = [
  "B1",
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

// Random Forest Training/Test Split
var SPLIT = 0.8;

// //Merge land cover classifications into one feature class
var FC_L7 = Built_Up.merge(Bare_Soil)
  .merge(Mixed_Grassland)
  .merge(Agriculture)
  .merge(Dense_Vegetation)
  .merge(Water);

// Function to mask clouds using the quality band of Landsat 8.
var maskL7 = function (image) {
  var qa = image.select("BQA");
  /// Check that the cloud bit is off.
  // See https://landsat.usgs.gov/collectionqualityband
  var mask = qa.bitwiseAnd(1 << 4).eq(0);
  return image.updateMask(mask);
};

// HSV-based Pan-Sharpening of Landsat 8 TOA images.
var panSharpen7 = function (image) {
  var rgb = image.select("B4", "B3", "B2");
  var pan = image.select("B8");

  // Convert to HSV, swap in the pan band, and convert back to RGB.
  var huesat = rgb.rgbToHsv().select("hue", "saturation");
  var upres = ee.Image.cat(huesat, pan).hsvToRgb();
  return image.addBands(upres);
};

// Add Landsat 7 Indices
var addIndicesL7 = function (image) {
  var ndvi = image.normalizedDifference(["B4", "B3"]).rename(["NDVI"]);
  var ndbi = image.normalizedDifference(["B5", "B4"]).rename(["NDBI"]);
  var ndwi = image.normalizedDifference(["B4", "B5"]).rename(["NDWI"]);
  var bsi = image
    .expression("(( X + Y ) - (A + B)) /(( X + Y ) + (A + B)) ", {
      X: image.select("B5"), //swir1
      Y: image.select("B3"), //red
      A: image.select("B4"), // nir
      B: image.select("B1"), // blue
    })
    .rename("BSI");
  return image.addBands(ndvi).addBands(ndbi).addBands(ndwi).addBands(bsi);
};

var landsat7Classifier = function (startDate, endDate) {
  // Map the function over Landsat 7 TOA data and take the median.
  var image = ee
    .ImageCollection("LANDSAT/LE07/C01/T1_TOA")
    .filterDate(startDate, endDate)
    .map(maskL7)
    .map(panSharpen7)
    .map(renameBand6)
    .median()
    .clip(studyarea);

  // //Fixing the scan line error - filling Gaps
  var img_fill = image.focal_mean(1, "square", "pixels", 9);
  var L705 = img_fill.blend(image);

  //Map.addLayer(L705.clip(studyarea), VIS_PARAM, '2005 Scan Line Fix');

  var compositeL7 = addIndicesL7(L705);

  //Make training data by 'overlaying' the points on the image.
  var points = compositeL7
    .select(BANDS_L7)
    .sampleRegions({
      collection: FC_L7,
      properties: ["Landcover"],
      scale: 30,
    })
    .randomColumn();

  //Randomly split the samples to set some aside for testing the model's accuracy
  //using the "random" column. Roughly 80% for training, 20% for testing.

  var training = points.filter(ee.Filter.lt("random", SPLIT)); //these are the two subsets of the training data
  var testing = points.filter(ee.Filter.gte("random", SPLIT));

  //Print these variables to see how much training and testing data you are using
  print("Samples n =", points.aggregate_count(".all"));
  print("Training n =", training.aggregate_count(".all"));
  print("Testing n =", testing.aggregate_count(".all"));

  // //******Part 4: Random Forest Classification and Accuracy Assessments******
  // //////////////////////////////////////////////////////////////////////////

  // //Run the RF model using 300 trees and 5 randomly selected predictors per split ("(300,5)").
  // //Train using bands and land cover property and pull the land cover property from classes
  var classifier = ee.Classifier.smileRandomForest(200, 5).train({
    features: training,
    classProperty: "Landcover",
    inputProperties: BANDS_L7,
  });

  // //Test the accuracy of the model   Print Confusion Matrix and Overall Accuracy
  var confusionMatrix = classifier.confusionMatrix();
  print("Confusion matrix: ", confusionMatrix);
  print("Training Overall Accuracy: ", confusionMatrix.accuracy());
  print(" Training Kappa: ", confusionMatrix.kappa());

  var validation = testing.classify(classifier);
  var testAccuracy = validation.errorMatrix("Landcover", "classification");
  print("Validation Error Matrix RF: ", testAccuracy);
  print("Validation Overall Accuracy RF: ", testAccuracy.accuracy());
  print("Validation Kappa:", testAccuracy.kappa());

  return classifier;
};

var classifyLandsat7 = function (classifier, startDate, endDate, year) {
  // //Apply the trained classifier to the image
  var image = ee
    .ImageCollection("LANDSAT/LE07/C01/T1_TOA")
    .filterDate(startDate, endDate)
    .map(maskL7)
    .map(panSharpen7)
    .map(renameBand6)
    .median()
    .clip(studyarea);

  var img_fill = image.focal_mean(1, "square", "pixels", 7);
  var L705 = img_fill.blend(image);
  var compositeL7 = addIndicesL7(L705);
  var classified = compositeL7
    .clip(studyarea)
    .select(BANDS_L7)
    .classify(classifier);

  // //Add final map to the display
  Map.addLayer(classified.sldStyle(urbanPalette), {}, year + " Classification");
  // Map.addLayer(
  //   L7,
  //   {
  //     bands: ["red", "green", "blue"],
  //     max: 0.3,
  //   },
  //   year + " Pansharpened"
  // );
  //print("Landsat " + year, compositeL7);

  return classified;
};

// PROCESSING
Map.centerObject(studyarea, 10);

// STEP I: Create Classifier
var classifier = landsat7Classifier("2005-03-16", "2005-04-20");

// STEP II: Classify Images
var classified_l7_05 = classifyLandsat7(
  classifier,
  "2005-03-16",
  "2005-04-20",
  2005
);

var areaImage = ee.Image.pixelArea().divide(1e6).addBands(classified_l7_05);

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
      "Bare_Soil",
      "Mixed_Grass",
    ],
  })
  .setOptions({
    hAxis: { title: "Classes" },
    vAxis: { title: "Area Km^2" },
    title: "Total Area by class in 2005",
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

//****CALCULATE COPABLE AREA OF EACH CLASS***////////////////////
for (var a = 1; a < 7; a++) {
  var x = classified_l7_05.eq(a).multiply(ee.Image.pixelArea());
  var calc = x.reduceRegion({
    reducer: ee.Reducer.sum(),
    geometry: studyarea,
    scale: 30,
    maxPixels: 1e13,
  });

  print(
    "2005_ID: " + a + " " + "in km2",
    calc,
    ee.Number(calc.values().get(0)).divide(1e6)
  );
}

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

// Export the classification result
Export.image.toDrive({
  image: classified_l7_05,
  description: "classified2005",
  folder: "EarthEngine",
  region: studyarea,
  scale: 30,
  maxPixels: 1e13,
});
