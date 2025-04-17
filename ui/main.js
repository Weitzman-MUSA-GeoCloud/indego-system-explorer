import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import * as d3 from 'd3';
import ApexCharts from 'apexcharts';
import * as deckLayers from '@deck.gl/layers';
import * as deckMapbox from '@deck.gl/mapbox';
import * as turf from "@turf/turf";
import * as _ from 'lodash';

// Initialize the map -- the base map tiles are loaded from Stadia maps, using
// the GitHub pages domain to authorize access. See the Stadia documantation at
// https://docs.stadiamaps.com/authentication/#domain-based-authentication
const bikesmap = new maplibregl.Map({
  container: 'map',
  style: 'https://tiles.stadiamaps.com/styles/alidade_smooth.json',
  center: [-75.1652, 39.9526], // Philadelphia coordinates
  zoom: 11,
});

// Set up a tooltip object for the map.
const tooltip = new maplibregl.Popup({
  closeButton: false,
  closeOnClick: false,
});

// Add a geojson outline of the city of Philadelphia
const outlineGeoJSONURL = 'https://opendata.arcgis.com/datasets/405ec3da942d4e20869d4e1449a2be48_0.geojson';
const outlineResp = await fetch(outlineGeoJSONURL);
const outlineData = await outlineResp.json();

// Placeholder data & state
let dataLayer = null;
let deckOverlay = null;
let stations = [];
let filters = {};
let startHour = 0;
let endHour = 23;
let aggregate = true;

async function fetchStationData() {
  // Expect this function to fetch data from a server or API.
  // The data should be an array of {P_o, P_d, P, station_id, geometry} objects.
  // We should then transform that into an array of GeoJSON features later.
  const url = `https://get-popularity-536078031908.us-east4.run.app?start_hour=${startHour}&end_hour=${endHour}`;
  const resp = await fetch(url);
  const data = await resp.json();

  stations = data;
}

function getDashboardFeatures() {
  const stationFeatures = stations
    .filter(row => row.station_id != 3000)
    .map(row => ({
      "type": "Feature",
      "id": row.station_id,
      "properties": {
        "originPopularity": row.P_o,
        "destinationPopularity": row.P_d,
        "totalPopularity": Math.max(row.P_o, row.P_d), // row.P,
      },
      geometry: JSON.parse(row.geometry),
    }));

  // Return the stations directly if we're not aggregating into hex cells.
  if (!aggregate) {
    return stationFeatures;
  }

  // If we are aggregating, use turf.js to create a hex grid within the bounds
  // of the convex hull around all the stations.
  const stationsHull = turf.convex({type: 'FeatureCollection', features: stationFeatures});

  // Aggregate into a hexGrid using turf
  const hexGrid = turf.hexGrid(turf.bbox(outlineData), 0.3, { units: 'kilometers' });
  const hexGridFeatures = []
  for (const [index, hex] of Object.entries(hexGrid.features)) {
    if (!turf.booleanIntersects(hex, stationsHull)) {
      continue;
    }

    const hexId = index;
    const matchingStations = stationFeatures.filter(station => station.geometry && turf.booleanIntersects(hex, station));

    if (matchingStations.length === 0) {
      continue;
    }

    const totalPopularity = matchingStations.reduce((sum, station) => sum + station.properties.totalPopularity, 0);
    const originPopularity = matchingStations.reduce((sum, station) => sum + station.properties.originPopularity, 0);
    const destinationPopularity = matchingStations.reduce((sum, station) => sum + station.properties.destinationPopularity, 0);

    const hexFeature = {
      type: 'Feature',
      id: hexId,
      properties: {
        originPopularity,
        destinationPopularity,
        totalPopularity,
      },
      geometry: hex.geometry,
    };
    hexGridFeatures.push(hexFeature);
  }
  return hexGridFeatures;

  // The data returned from this function will be structured like this:
  // return [
  //   {
  //     "type": "Feature",
  //     "id": "1",
  //     "properties": {
  //       "originPopularity": 2,
  //       "destinationPopularity": 10,
  //       "totalPopularity": 12
  //     },
  //     "geometry": {
  //       "coordinates": [ [ [ -75.1720778936854, 39.97749427991971 ], [ -75.163870196595, 39.97749552635568 ], [ -75.16326272495223, 39.98331737467109 ], [ -75.1705588121783, 39.98564419917082 ], [ -75.17663748121734, 39.98168498352882 ], [ -75.1720778936854, 39.97749427991971 ] ] ],
  //       "type": "Polygon"
  //     }
  //   },
  //   {
  //     "type": "Feature",
  //     "id": "2",
  //     "properties": {
  //       "originPopularity": 1,
  //       "destinationPopularity": 1,
  //       "totalPopularity": 2
  //     },
  //     "geometry": {
  //       "coordinates": [ [ [ -75.18391798653394, 39.935082846544674 ], [ -75.1711457859893, 39.93531607568835 ], [ -75.17357859479421, 39.94137836984899 ], [ -75.17965999696777, 39.944642131744814 ], [ -75.18847767643737, 39.93881122346468 ], [ -75.18391798653394, 39.935082846544674 ] ] ],
  //       "type": "Polygon"
  //     }
  //   },
  //   {
  //     "type": "Feature",
  //     "id": "3",
  //     "properties": {
  //       "originPopularity": 7,
  //       "destinationPopularity": 2,
  //       "totalPopularity": 9
  //     },
  //     "geometry": {
  //       "coordinates": [ [ [ -75.15015407379488, 39.936012142165 ], [ -75.14346101474209, 39.9339125378892 ], [ -75.13981171535943, 39.93857708121425 ], [ -75.14437512231237, 39.94277494206344 ], [ -75.1538085371629, 39.94067775330066 ], [ -75.15015407379488, 39.936012142165 ] ] ],
  //       "type": "Polygon"
  //     }
  //   }
  // ];
}

// Update the map based on the current view
function updateMap(features) {
  // Clear existing layers
  clearMapLayers();

  const filteredFeatures = features.filter(feature => (
      (filters.originPopularityMin === undefined || feature.properties.originPopularity >= filters.originPopularityMin) &&
      (filters.originPopularityMax === undefined || feature.properties.originPopularity <= filters.originPopularityMax) &&
      (filters.destinationPopularityMin === undefined || feature.properties.destinationPopularity >= filters.destinationPopularityMin) &&
      (filters.destinationPopularityMax === undefined || feature.properties.destinationPopularity <= filters.destinationPopularityMax)
  ));

  // Add feature markers
  dataLayer = new deckLayers.GeoJsonLayer({
    id: 'geojson-layer',
    data: {
      type: 'FeatureCollection',
      features: filteredFeatures,
    },
    pickable: true,
    filled: true,
    pointRadiusMinPixels: 5,
    lineWidthMinPixels: 1,
    getLineColor: d => {
      const color = calculateColor(d.properties.originPopularity, d.properties.destinationPopularity, d.properties.totalPopularity);
      // Convert color to RGB format
      const rgb = d3.rgb(color);
      return [rgb.r, rgb.g, rgb.b];
    },
    getFillColor: d => {
      const color = calculateColor(d.properties.originPopularity, d.properties.destinationPopularity, d.properties.totalPopularity);
      const opacity = calculateOpacity(d.properties.totalPopularity, features);
      // Convert color to RGB format
      const rgb = d3.rgb(color);
      return [rgb.r, rgb.g, rgb.b, opacity * 255];
    },
    onHover: ({ object, x, y }) => {
      if (object) {
        const percentile = (object.properties.totalPopularity - 0) / (Math.max(...features.map(r => r.properties.totalPopularity)) - 0);
        const point = turf.center(object.geometry);
        tooltip.setLngLat([point.geometry.coordinates[0], point.geometry.coordinates[1]])
          .setHTML(`ID: ${object.id}<br>Origin Popularity: ${object.properties.originPopularity.toFixed(2)}<br>Destination Popularity: ${object.properties.destinationPopularity.toFixed(2)}<br>Total Popularity: ${object.properties.totalPopularity.toFixed(2)} <br>Percentile: ${(percentile * 100).toFixed(1)}%`)
          .addTo(bikesmap);
      } else {
        tooltip.remove();
      }
    }
  });

  // Add the layer to the map
  deckOverlay = new deckMapbox.MapboxOverlay({
    layers: [dataLayer],
  })

  bikesmap.addControl(deckOverlay);
}

// Clear all map layers
function clearMapLayers() {
  if (dataLayer) {
    bikesmap.removeControl(deckOverlay);
    dataLayer = null;
    deckOverlay = null;
  }
}

window.clearMapLayers = clearMapLayers;

// Calculate color based on popularity
function calculateColor(originPopularity, destinationPopularity, totalPopularity) {
  const value = (destinationPopularity - originPopularity) / totalPopularity;
  return d3.scaleSequential(d3.interpolateMagma).domain([-1, 1])(value);
}

// Calculate opacity for s2 regions
function calculateOpacity(totalPopularity, features) {
  const minOpacity = 0.1;
  const maxOpacity = 1.0;
  const scale = d3.scaleLinear().domain([0, Math.max(...features.map(r => r.properties.totalPopularity))]).range([minOpacity, maxOpacity]);
  return scale(totalPopularity);
}

// Update the legend based on the range of popularities; show the magma color
// ramp and how the colors correspond to the popularity values.
function updateLegend(features) {
  // const minPopularity = Math.min(...features.map(r => r.properties.totalPopularity));
  // const maxPopularity = Math.max(...features.map(r => r.properties.totalPopularity));
  const colorScale = d3.scaleSequential(d3.interpolateMagma).domain([0, 100]);
  const opacityScale = d3.scaleSequential(d3.interpolateRgb("silver", colorScale(50))).domain([0, 100]);
  legend.innerHTML = ''; // Clear previous legend

  legend.innerHTML = `
    <ol class="legend-scale-labels">
      <li>More Pick-ups</li>
      <li>More Drop-offs</li>
    </ol>
    <div class="gravity-scale"></div>

    <ol class="legend-scale-labels">
      <li>Less Popular</li>
      <li>More Popular</li>
    </ol>
    <div class="popularity-scale"></div>
  `

  const gravityScale = legend.querySelector('.gravity-scale');
  const popularityScale = legend.querySelector('.popularity-scale');

  for (let i = 0; i < 100; ++i) {
    gravityScale.innerHTML += `<span class="band" style="background-color:${colorScale(i)}"></span>`;
    popularityScale.innerHTML += `<span class="band" style="background-color:${opacityScale(i)}"></span>`;
  }
}

// Update charts
function updateCharts(features) {
  delete filters.originPopularityMin;
  delete filters.originPopularityMax;
  delete filters.destinationPopularityMin;
  delete filters.destinationPopularityMax;

  renderChart('origin-chart', features, 'Origin Popularity', 'originPopularity');
  renderChart('destination-chart', features, 'Destination Popularity', 'destinationPopularity');
}

// Render a histogram chart
function renderChart(containerId, features, title, property) {
  const container = document.getElementById(containerId);
  const width = container.clientWidth;
  const height = Math.min(container.clientHeight, 300);

  // Bin the popularity of each station
  const histogramData = d3.bin()
    .value(d => d.properties[property])
    .domain([0, Math.max(...features.map(r => r.properties[property]))])
    .thresholds(20)(features);

  const chartOptions = {
    chart: {
      type: 'bar',
      width: width,
      height: height,
      events: {
        dataPointSelection: (event, chartContext, opts) => {
          const selection = opts.selectedDataPoints[0];
          if (selection.length === 0) {
            delete filters[property + 'Min'];
            delete filters[property + 'Max'];
            console.log('No selection');
          } else {
            const i = selection[0];
            const min = histogramData[i].x0;
            const max = histogramData[i].x1;
            filters[property + 'Min'] = min;
            filters[property + 'Max'] = max;
          }
          updateMap(features);
        }
      },
    },
    series: [{
      name: title,
      data: histogramData.map(d => ({
        x: d.x0,
        y: d.length,
      })),
    }],
    xaxis: {
      type: 'numeric',
      title: {
        text: title,
      },
    },
    yaxis: {
      title: {
        text: `Number of ${aggregate ? 'Cells' : 'Stations'}`,
      },
    },
    plotOptions: {
      bar: {
        horizontal: false,
        columnWidth: '100%',
        endingShape: 'rounded',
      },
    },
    dataLabels: {
      enabled: false,
    },
    tooltip: {
      shared: true,
      intersect: false,
      x: {
        formatter: (value, {dataPointIndex, series, seriesIndex}) => {
          const i = dataPointIndex;
          const min = histogramData[i].x0;
          const max = histogramData[i].x1;
          return `${title} ${min} - ${max}`;
        },
      },
      y: {
        title: {
          formatter: (seriesName) => `Number of ${aggregate ? 'Cells' : 'Stations'}`
        },
      }
    },
  };

  if (!container.chart) {
    container.chart = new ApexCharts(container, chartOptions);
    container.chart.render();
  } else {
    container.chart.updateOptions(chartOptions);
  }
}

let isUpdating = false;
let updateTimeout = null;
async function updateAll() {
  if (updateTimeout) {
    clearTimeout(updateTimeout);
  }

  if (isUpdating) {
    updateTimeout = setTimeout(updateAll, 100);
    return;
  }

  isUpdating = true;
  console.log('Updating map and charts...');

  loader.classList.remove('hidden');

  await fetchStationData();
  const features = getDashboardFeatures();
  updateMap(features);
  updateLegend(features);
  updateCharts(features);

  loader.classList.add('hidden');

  isUpdating = false;
}

// Add an hour selector
const startHourRange = document.getElementById('start-hour');
const endHourRange = document.getElementById('end-hour');

startHourRange.value = startHour;
endHourRange.value = endHour;

startHourRange.addEventListener('input', _.debounce(async () => {
  startHour = parseInt(startHourRange.value);

  if (startHour >= endHour) {
    endHour = startHour + 1;
    endHourRange.value = endHour;
  }

  await updateAll();
}, 500));

endHourRange.addEventListener('input', _.debounce(async () => {
  endHour = parseInt(endHourRange.value);

  if (endHour <= startHour) {
    startHour = endHour - 1;
    startHourRange.value = startHour;
  }

  await updateAll();
}, 500));

// Add a checkbox for aggregate
const isAggregatedCheckbox = document.getElementById('is-aggregated');

isAggregatedCheckbox.checked = aggregate;

isAggregatedCheckbox.addEventListener('change', async () => {
  aggregate = isAggregatedCheckbox.checked;
  await updateAll();
});

// The map legend, showing the color ramp and how it corresponds to the popularity values.
const legend = document.getElementById('map-legend');

// The spinner, for when data is loading for the map and such
const loader = document.querySelector('.loader-overlay');

// Initial render
bikesmap.on('load', async () => {
  // Add the outline of Philadelphia
  bikesmap.addSource('philadelphia-outline', {
    type: 'geojson',
    data: outlineData,
  });
  bikesmap.addLayer({
    id: 'philadelphia-outline',
    type: 'line',
    source: 'philadelphia-outline',
    paint: {
      'line-color': '#000000',
      'line-width': 2,
    },
  });
  await updateAll();
});