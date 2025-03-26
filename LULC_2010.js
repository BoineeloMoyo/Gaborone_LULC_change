//Create palette for the final land cover map classifications
var urbanPalette =
  "<RasterSymbolizer>" +
  ' <ColorMap  type="intervals">' +
  '<ColorMapEntry color="#42f132" quantity="1" label="Agriculture"/>' +
  '<ColorMapEntry color="#81485c" quantity="2" label="Built_Up"/>' +
  '<ColorMapEntry color="#117a17" quantity="3" label="Dense_Vegetation"/>' +
  '<ColorMapEntry color="#4dc6ff" quantity="4" label="Water"/>' +
  '<ColorMapEntry color="#f5deb7" quantity="5" label="Bare_Soil"/>' +
  '<ColorMapEntry color="#cbe77e" quantity="6" label="Mixed_grassland"/>' +
  "</ColorMap>" +
  "</RasterSymbolizer>";

Map.centerObject(studyarea, 11);

//Function to mask clouds using the quality band of Landsat 8.
var cloudmask = function (image) {
  var qa = image.select("BQA");
  /// Check that the cloud bit is off. See https://landsat.usgs.gov/collectionqualityband
  var mask = qa.bitwiseAnd(1 << 4).eq(0);
  return image.updateMask(mask);
};

function renameBand6(image) {
  var bands = ["B1", "B2", "B3", "B4", "B5", "B6_VCID_1", "B7", "B8"];
  var new_bands = ["B1", "B2", "B3", "B4", "B5", "B6", "B7", "B8"];
  return image.select(bands).rename(new_bands);
}
// HSV-based Pan-Sharpening of Landsat 7 TOA images.
var panSharpen = function (image) {
  var rgb = image.select("B3", "B2", "B1");
  var pan = image.select("B8");

  // Convert to HSV, swap in the pan band, and convert back to RGB.
  var huesat = rgb.rgbToHsv().select("hue", "saturation"); 
  var upres = ee.Image.cat(huesat, pan).hsvToRgb();
  return image.addBands(upres);
};
var visPar = { bands: ["B3", "B2", "B1"], min: 0, max: 0.3, gamma: 1.4 };

var L10 = ee
  .ImageCollection("LANDSAT/LE07/C01/T1_TOA")
  .filterBounds(studyarea)
  .filterDate("2010-01-16", "2010-02-28") //summer time
  .sort("CLOUD_COVER", true)
  .limit(10)
  .map(cloudmask)
  .map(renameBand6)
  .map(panSharpen)
  .median()
  .clip(studyarea);

print(L10, "Landsat 2010 Image");

Map.addLayer(L10, visPar, "05 Image");

// //Fixing the scan line error - filling Gaps
var img_fill = L10.focal_mean(1, "square", "pixels", 9);
var L710 = img_fill.blend(L10);

//Map.addLayer(L710.clip(studyarea), visPar, 'Filled Image');
Map.addLayer(
  L710.clip(studyarea),
  { bands: ["red", "green", "blue"], max: 0.3 },
  "2010 Pansharpened"
);

//********************Add indices to improve Classification********///
var addIndices = function (image) {
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

var composite = addIndices(L710);
//print(composite, 'Composite Image');

// //Merge land cover classifications into one feature class
var newfc = Agriculture.merge(Water)
  .merge(Mixed_grassland)
  .merge(Bare_Soil)
  .merge(Dense_Vegetation)
  .merge(Built_Up);

// //Specify the bands to use in the prediction.
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

//Make training data by 'overlaying' the points on the image.
var points = composite
  .select(bands)
  .sampleRegions({
    collection: newfc,
    properties: ["Landcover"],
    scale: 30,
  })
  .randomColumn();

// //Randomly split the samples to set some aside for testing the model's accuracy
// //using the "random" column. Roughly 70% for training, 30% for testing.
var split = 0.7;
var training = points.filter(ee.Filter.lt("random", split)); //these are the two subsets of the training data
var testing = points.filter(ee.Filter.gte("random", split));

//Print these variables to see how much training and testing data you are using
print("Samples n =", points.aggregate_count(".all"));
print("Training n =", training.aggregate_count(".all"));
print("Testing n =", testing.aggregate_count(".all"));

// // //******Part 4: Random Forest Classification and Accuracy Assessments******
// // //////////////////////////////////////////////////////////////////////////

// //Run the RF model using 200 trees and 5 randomly selected predictors per split ("(200,5)").
// //Train using bands and land cover property and pull the land cover property from classes
var classifier = ee.Classifier.smileRandomForest(200, 5).train({
  features: training,
  classProperty: "Landcover",
  inputProperties: bands,
});

// // //Test the accuracy of the model
// // ////////////////////////////////////////

// //Print Confusion Matrix and Overall Accuracy
var confusionMatrix = classifier.confusionMatrix();
print("2010 Confusion matrix: ", confusionMatrix);
print("2010 Training Overall Accuracy: ", confusionMatrix.accuracy());
var kappa = confusionMatrix.kappa();
print("2010 Training Kappa", kappa);

var validation = testing.classify(classifier);
var testAccuracy = validation.errorMatrix("Landcover", "classification");
print("2010 Validation Error Matrix RF: ", testAccuracy);
print("2010 Validation Overall Accuracy RF: ", testAccuracy.accuracy());
var kappa1 = testAccuracy.kappa();
// print('2010 Validation Kappa', kappa1);

// //Apply the trained classifier to the image
var classified10 = composite.select(bands).classify(classifier).clip(studyarea);
Map.addLayer(classified10.sldStyle(urbanPalette), {}, "2010 Classified");

// // .area() function calculates the area in square meters
var cityArea = studyarea.geometry().area().divide(1e6);
print(cityArea, "Gaborone Area");

var areaImage = ee.Image.pixelArea().divide(1e6).addBands(classified10);

//Plot a graph of class area totals (in km2)
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
      "DUMMY CLASS",
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
    title: "Total Area by class in 2010",
    series: {
      0: { color: "#42f132" },
      1: { color: "#81485c" },
      2: { color: "#117a17" },
      3: { color: "#4dc6ff" },
      4: { color: "#f5deb7" },
      5: { color: "#cbe77e" },
    },
  });
print(areaChart);

//****CALCULATE AREA OF EACH CLASS***////////////////////
for (var a = 1; a < 7; a++) {
  var x = classified10.eq(a).multiply(ee.Image.pixelArea());
  var calc = x.reduceRegion({
    reducer: ee.Reducer.sum(),
    geometry: studyarea,
    scale: 30,
    maxPixels: 1e13,
  });

  print(
    "2010_ID: " + a + " " + "in km2",
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
var palette = ["42f132", "81485c", "117a17", "4dc6ff", "f5deb7", "cbe77e"];

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

//Export the classification result
Export.image.toDrive({
  image: classified10,
  description: "classified2010",
  folder: "EarthEngine",
  region: studyarea,
  scale: 30,
  maxPixels: 1e13,
});
