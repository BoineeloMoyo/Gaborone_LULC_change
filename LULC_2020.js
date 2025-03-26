var shp = ee.FeatureCollection(STUDY_AREA);
Map.addLayer(shp, {}, "ProjectBoundary");

//Create palette for the final land cover map classifications
var URBAN_PALETTE =
  "<RasterSymbolizer>" +
  ' <ColorMap  type="intervals">' +
  '<ColorMapEntry color="#42f132" quantity="1" label="Agricultural_Lands"/>' +
  '<ColorMapEntry color="#81485c" quantity="2" label="Built_Up"/>' +
  '<ColorMapEntry color="#117a17" quantity="3" label="Dense_Vegetation"/>' +
  '<ColorMapEntry color="#54d4ff" quantity="4" label="Water"/>' +
  '<ColorMapEntry color="#f5deb7" quantity="5" label="Bare_Soil"/>' +
  '<ColorMapEntry color="#cbe77e" quantity="6" label="Mixed_Grassland"/>' +
  "</ColorMap>" +
  "</RasterSymbolizer>";

var VIS_PARAM_L8 = {
  bands: ["B4", "B3", "B2"],
  min: 0,
  max: 0.3,
  gamma: 1.4,
};

// //Specify the bands to use in the prediction.
var BANDS_L8 = [
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
var FC_L8 = Built_Up.merge(Bare_Soil)
  .merge(Mixed_Grassland)
  .merge(Agricultural_Lands)
  .merge(Dense_Vegetation)
  .merge(Water);

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

// Add Landsat 8 Indices
var addIndicesL8 = function (image) {
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

var landsat8Classifier = function (startDate, endDate) {
  // Map the function over Landsat 8 TOA data and take the median.
  var L8 = ee
    .ImageCollection("LANDSAT/LC08/C01/T1_TOA")
    .filterDate(startDate, endDate)
    .map(maskL8)
    .map(panSharpen)
    .median()
    .clip(STUDY_AREA);

  var compositeL8 = addIndicesL8(L8);

  //Make training data by 'overlaying' the points on the image.
  var points = compositeL8
    .select(BANDS_L8)
    .sampleRegions({
      collection: FC_L8,
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
    inputProperties: BANDS_L8,
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

var classifyLandsat8 = function (classifier, startDate, endDate, year) {
  // //Apply the trained classifier to the image
  var L8 = ee
    .ImageCollection("LANDSAT/LC08/C01/T1_TOA")
    .filterDate(startDate, endDate)
    .map(maskL8)
    .map(panSharpen)
    .median()
    .clip(STUDY_AREA);

  var composite = addIndicesL8(L8);
  var classified = composite.select(BANDS_L8).classify(classifier);

  //Add final map to the display
  Map.addLayer(
    classified.sldStyle(URBAN_PALETTE),
    {},
    year + " Classification"
  );
  // // Map.addLayer(
  //   L8,
  //   {
  //     bands: ["red", "green", "blue"],
  //     max: 0.3,
  //   },
  //   year + " Pansharpened"
  // );
  // print("Landsat " + year, composite);

  return classified;
};

// PROCESSING
Map.centerObject(STUDY_AREA, 11);

// STEP I: Create Classifier
var classifier = landsat8Classifier("2020-01-16", "2020-02-05");

// STEP II: Classify Images
var classified_l8_20 = classifyLandsat8(
  classifier,
  "2020-01-16",
  "2020-02-05",
  2020
);
//print(classified, ' RF Propoerties')
// //********************Calculate AREA per each class*****///
var areaImage = ee.Image.pixelArea().divide(1e6).addBands(classified_l8_20);

// Calculate Area by Class ****Using a Grouped Reducer***////
var areas = areaImage.reduceRegion({
  reducer: ee.Reducer.sum().group({
    groupField: 1,
    groupName: "Landcover",
  }),
  geometry: STUDY_AREA,
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
    region: STUDY_AREA,
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
    title: "Area by class 2020",
    series: {
      1: { color: "#42f132" },
      2: { color: "#81485c" },
      3: { color: "#117a17" },
      4: { color: "#54d4ff" },
      5: { color: "#f5deb7" },
      6: { color: "#cbe77e" },
    },
  });
print(areaChart);

for (var a = 1; a < 7; a++) {
  var x = classified_l8_20.eq(a).multiply(ee.Image.pixelArea());
  var calc = x.reduceRegion({
    reducer: ee.Reducer.sum(),
    geometry: STUDY_AREA,
    scale: 30,
    maxPixels: 1e13,
  });

  print(
    "2020_ID: " + a + " " + "in km2",
    calc,
    ee.Number(calc.values().get(0)).divide(1e6)
  );
}

// // ******Part 5:Create a legend******///
//Set position of panel
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
  "Mixed_Vegetation",
];

//Add color and names
for (var i = 0; i < 6; i++) {
  legend.add(makeRow(palette[i], names[i]));
}

//Add legend to map
Map.add(legend);

//Export the classification result
Export.image.toDrive({
  image: classified_l8_20,
  description: "classified2020",
  folder: "EarthEngine",
  region: STUDY_AREA,
  scale: 30,
  maxPixels: 1e13,
});
