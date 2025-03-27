# Gaborone_LULC_change
The complete publication of this project can be found in the **Springer Nature's Remote Sensing in Earth Systems Sciences** journal [HERE](https://link.springer.com/article/10.1007/s41976-024-00171-7) and a comprehensive 2023 ESRI's Climate Change challenge blog about this project has been published throgh a story map [HERE](https://storymaps.com/stories/8f482da3617043c7ba24aa54ee844b42)

## Random Forest Classification for Land Use Change in Gaborone, Botswana
### Land Use Land Cover (LULC) Change VS Land Surface Temperature (LST)
<img width="1235" alt="Screenshot 2024-01-08 at 14 49 55" src="https://github.com/BoineeloMoyo/Gaborone_LULC_change/assets/82944675/02c17a58-c4a5-43eb-9b1a-359db1ea4e8f">

<img width="1237" alt="Screenshot 2024-01-08 at 14 50 17" src="https://github.com/BoineeloMoyo/Gaborone_LULC_change/assets/82944675/fd410413-2f4d-4f30-8492-9e8a43ea6a1a">


This repository contains code for performing land use change classification using random forest algorithm in the Google Earth Engine platform.
The classification is done using Landsat 8 and Landsat 7 imagery for the years 2005, 2010, 2015, and 2020. The study area for this analysis is Gaborone, the capital city of Botswana.

1. Dataset
   The dataset used in this analysis consists of Landsat 8 and Landsat 7 satellite imagery. The Landsat images were selected based on their availability and suitability for land use change analysis. The dataset covers the years 2005, 2010, 2015, and 2020, providing a temporal perspective of land use changes in Gaborone.

2. Pre-processing: 
   The 2005 Landsat image had some scan line errors that needed to be gap filled. Gap filling was performed using appropriate algorithms to fill in missing values and ensure a complete image. Additionally, the 2005 image was pan-sharpened to enhance its resolution for better classification accuracy.
3. Classification
   The random forest algorithm was chosen for land use change classification due to its ability to handle multi-class classification problems effectively.
   The classification code provided in this repository is divided into separate scripts for each year: 2005, 2010, 2015, and 2020. This division allows for better organization and easier replication of results. The land use classes considered for classification are as follows:

- Built-up
- Water
- Soil 
- Agriculture  
- Dense Vegetation
- Mixed Grassland 

The random forest model was trained using labeled samples from the different land use classes. Feature selection techniques and preprocessing steps were applied to prepare the input data for the classification model.

4. Results
   The results of the land use change classification are presented in the form of classified maps for each year: 2005, 2010, 2015, and 2020, which can be viewed here [Gaborone LULC Classification](https://storymaps.com/stories/8f482da3617043c7ba24aa54ee844b42). The classified maps provide insights into the spatial distribution and changes in land use categories over time. Additionally, accuracy assessment metrics such as overall accuracy and kappa coefficient were calculated to evaluate the performance of the classification algorithm. These metrics give an indication of how well the model performs in classifying the different land use categories.
   ![Overall Accuracy Example](https://github.com/BoineeloMoyo/Gaborone_LULC_change/assets/82944675/d363a895-582a-4263-9450-6e792064a29a)
5. Usage
   To run the code in this repository, you will need access to Google Earth Engine platform and the necessary permissions to access and analyze Landsat imagery.
   The code files are organized by year, and you can run each script independently to perform land use change classification for the corresponding year. You will need to create your own sampling datasets.
   Please make sure to update the necessary input file paths and parameters in the code before running the scripts. Additionally, refer to the comments provided within the code for
   further instructions and details about specific steps.

6. License
   This project is licensed under the [MIT License](LICENSE), which means you can freely use and modify the code for your own purposes. However, attribution is appreciated.
