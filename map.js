// map.js
import mapboxgl from 'https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm';
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7/+esm';

// —— 你的 Mapbox Token —— 
mapboxgl.accessToken = 'pk.eyJ1IjoiZXZlcmNsb3VkIiwiYSI6ImNtYXJrNm4xcjA3MGgya29rbHlubGNncTkifQ.GROl-XaK5C76yQiSXs-j_w';

const map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/mapbox/streets-v11',
  center: [-71.092761, 42.357575],
  zoom: 13
});

map.on('load', async () => {
  // 1⃣ 插入 SVG 图层
  const svg = d3.select(map.getCanvasContainer())
    .append('svg')
      .attr('id', 'station-layer')
      .style('position','absolute')
      .style('top',0)
      .style('left',0)
      .style('width','100%')
      .style('height','100%')
      .style('pointer-events','none');

  // 2⃣ 添加车道图层 —— 本地 Boston & Cambridge
  map.addSource('boston_route', {
    type: 'geojson',
    data: 'assets/boston-bike-lanes.geojson'   // 本地下载好的 GeoJSON
  });
  map.addLayer({
    id: 'boston_route',
    type: 'line',
    source: 'boston_route',
    paint: { 'line-color':'#006400', 'line-width':3 }
  });

  map.addSource('cambridge_route', {
    type: 'geojson',
    data: 'assets/cambridge-bike-lanes.geojson'
  });
  map.addLayer({
    id: 'cambridge_route',
    type: 'line',
    source: 'cambridge_route',
    paint: { 'line-color':'#00008B', 'line-width':3 }
  });

  // 3⃣ 加载站点并绘制圆点
  const stations = (await d3.json('assets/bluebike-stations.json')).data.stations;
  const project = d => map.project([+d.lon, +d.lat]);

  const circles = svg.selectAll('circle')
    .data(stations, d => d.short_name)
    .enter()
    .append('circle')
      .attr('fill','crimson')
      .attr('r',4)
      .attr('opacity',0.8)
      .attr('id', d => d.short_name);

  function updatePositions(){
    circles
      .attr('cx', d => project(d).x)
      .attr('cy', d => project(d).y);
  }
  updatePositions();
  map.on('move', updatePositions);
  map.on('zoom', updatePositions);
  map.on('moveend', updatePositions);

  // 4⃣ 载入并预分桶 Trip 数据
  const rawTrips = await d3.csv('assets/bluebike-trips.csv', d => {
    d.started_at = new Date(d.started_at);
    d.ended_at   = new Date(d.ended_at);
    return d;
  });
  const departuresByMinute = Array.from({ length:1440 }, ()=>[]);
  const arrivalsByMinute   = Array.from({ length:1440 }, ()=>[]);
  const minutesSinceMidnight = dt => dt.getHours()*60 + dt.getMinutes();

  rawTrips.forEach(trip => {
    departuresByMinute[minutesSinceMidnight(trip.started_at)].push(trip);
    arrivalsByMinute[minutesSinceMidnight(trip.ended_at)].push(trip);
  });

  // 5⃣ 计算 Station Traffic
  function computeStationTraffic(timeFilter = -1) {
    function sliceTrips(buckets, m) {
      if (m === -1) return buckets.flat();
      const start = (m - 60 + 1440) % 1440;
      const end   = m % 1440;
      if (start <= end) {
        return buckets.slice(start, end).flat();
      } else {
        return buckets.slice(start).concat(buckets.slice(0, end)).flat();
      }
    }
    const deps = d3.rollup(
      sliceTrips(departuresByMinute, timeFilter),
      v=>v.length, d=>d.start_station_id
    );
    const arrs = d3.rollup(
      sliceTrips(arrivalsByMinute, timeFilter),
      v=>v.length, d=>d.end_station_id
    );
    return stations.map(s => {
      const d = deps.get(s.short_name) || 0;
      const a = arrs.get(s.short_name) || 0;
      return { ...s, departures:d, arrivals:a, totalTraffic:d+a };
    });
  }

  // 6⃣ 滑块 & 大小比例尺 & 颜色比例尺
  const slider    = document.getElementById('time-slider');
  const timeLabel = document.getElementById('selected-time');
  const anyLabel  = document.getElementById('any-time');

  const radiusScale = d3.scaleSqrt().range([0,25]);
  const flowScale   = d3.scaleQuantize().domain([0,1]).range([0,0.5,1]);

  function formatTime(m) {
    if (m === -1) return '';
    const hh = String(Math.floor(m/60)).padStart(2,'0');
    const mm = String(m%60).padStart(2,'0');
    return `${hh}:${mm}`;
  }

  function updateScatterPlot(tf) {
    const data = computeStationTraffic(tf);
    const maxT = d3.max(data, d=>d.totalTraffic);
    radiusScale.domain([0, maxT||1]);

    circles.data(data, d=>d.short_name).join('circle')
      .attr('r', d=>radiusScale(d.totalTraffic))
      .style('--departure-ratio', d=>
        flowScale(d.departures/(d.totalTraffic||1))
      );
    updatePositions();
  }

  function updateTimeDisplay() {
    const v = +slider.value;
    timeLabel.textContent = formatTime(v);
    anyLabel.style.display = v===-1 ? 'inline' : 'none';
    updateScatterPlot(v);
  }

  slider.addEventListener('input', updateTimeDisplay);
  updateTimeDisplay();

  // 7⃣ 插入图例
  d3.select('body')
    .append('div')
    .attr('class','legend')
    .html(`
      <div style="--departure-ratio:1">More departures</div>
      <div style="--departure-ratio:0.5">Balanced</div>
      <div style="--departure-ratio:0">More arrivals</div>
    `);
});
