var stationLookup = {};
var lineLookup = {};
var trackedCar;

var MapboxGLButtonControl = function(options) {
	this.initialize(options);
};

MapboxGLButtonControl.prototype.initialize = function(options) {
	this._className = options.className || '';
	this._title = options.title || '';
	this._eventHandler = options.eventHandler;
}

MapboxGLButtonControl.prototype.onAdd = function(map) {
	this._btn = document.createElement('button');
	this._btn.className = "mapboxgl-ctrl-icon" + ' ' + this._className;
	this._btn.type = 'button';
	this._btn.title = this._title;
	this._btn.onclick = this._eventHandler;

	this._container = document.createElement('div');
	this._container.className = 'mapboxgl-ctrl-group mapboxgl-ctrl';
	this._container.appendChild(this._btn);

	return this._container;
};

MapboxGLButtonControl.prototype.onRemove = function() {
	this._container.parentNode.removeChild(this._container);
	this._map = undefined;
};

var map = new mapboxgl.Map({
	container: 'map',
	style: 'data/osm-liberty.json',
	attributionControl: true,
	hash: true,
	center: [139.7670, 35.6814],
	zoom: 14,
	pitch: 60
});
map.addControl(new mapboxgl.NavigationControl());
map.addControl(new mapboxgl.FullscreenControl());
map.addControl(new MapboxGLButtonControl({
	className: 'mapbox-gl-track',
	title: '追跡',
	eventHandler: function() {
		trackedCar = trackedCar === undefined ? 0 : trackedCar === 9 ? undefined : trackedCar + 1;
	}
}), 'top-right');
map.addControl(new MapboxGLButtonControl({
	className: 'mapbox-gl-github',
	title: 'GitHub',
	eventHandler: function() {
		window.open('https://github.com/nagix/mini-tokyo-3d');
	}
}), 'top-right');

Promise.all([
	loadJSON('data/dictionary-' + getLang() + '.json'),
	loadJSON('data/lines.json'),
	loadJSON('data/stations.json'),
	loadJSON('data/cars.json')
]).then(function([dict, lineData, stationData, carData]) {

var stationCollection = turf.featureCollection(stationData.stations.map(function(station) {
	var span = station.span;
	var properties = {outlineColor: '#000000', width: 4, color: '#FFFFFF'};
	var point = turf.point(station.coords, properties);

	// Build station loopup dictionary
	stationLookup[station.name] = station;
	if (station.alias) {
		stationLookup[station.alias] = station;
	}

	return turf.transformRotate(turf.buffer(span ? turf.lineString([
		turf.getCoord(turf.transformTranslate(point, span[0] * .1, 90)),
		turf.getCoord(turf.transformTranslate(point, span[1] * .1, 90))
	], properties) : point, .1), station.angle || 0, {pivot: station.coords, mutate: true});
}));

var lineCollection = turf.featureCollection(lineData.lines.map(function(line) {
	var stations = line.stations;

	// Build line loopup dictionary
	lineLookup[line.name] = line;

	line.feature = turf.lineString(concat(line.sublines.map(function(subline) {
		var overlap = lineLookup[subline.line];
		var start, end, stations;

		if (overlap) {
			start = subline.start;
			end = subline.end;
			subline.feature = turf.lineOffset(turf.lineSlice(
				turf.point(stationLookup[start].coords),
				turf.point(stationLookup[end].coords),
				overlap.feature
			), subline.offset * .125);
			stations = overlap.stations;
			if (stations.indexOf(start) > stations.indexOf(end)) {
				turf.rewind(subline.feature, {mutate: true});
			}
		}

		return subline;
	}).map(function(subline, i, sublines) {
		var coordinates, nextSubline;

		function smoothCoords(reverse) {
			var start = !reverse ? 0 : coordinates.length - 1;
			var end = !reverse ? coordinates.length - 1 : 0;
			var step = !reverse ? 1 : -1;
			var stationName = !reverse ? nextSubline.end : nextSubline.start;
			var nextCoordinates = turf.getCoords(nextSubline.feature);
			var CoordsIndex = !reverse ? nextCoordinates.length - 1 : 0;
			var feature = lineLookup[nextSubline.line].feature;
			var offset = turf.distance(
				turf.point(stationLookup[stationName].coords),
				turf.point(nextCoordinates[CoordsIndex])
			);
			var j, p1, p2, distance;

			for (j = start; j !== end; j += step) {
				p1 = turf.point(coordinates[j]);
				p2 = turf.nearestPointOnLine(feature, p1);
				distance = p2.properties.dist;
				if (distance > offset * 5) {
					break;
				}
				coordinates[j] = turf.getCoord(turf.transformTranslate(
					p1,
					distance <= offset ? offset : offset - (distance - offset) / 4,
					turf.bearing(p2, p1) + (nextSubline.offset < 0 ? 180 : 0)
				));
			}
			coordinates[start] = nextCoordinates[CoordsIndex];
		}

		if (!subline.line) {
			coordinates = subline.coordinates;
			nextSubline = sublines[i - 1];
			if (nextSubline && nextSubline.line) {
				smoothCoords();
			}
			nextSubline = sublines[i + 1];
			if (nextSubline && nextSubline.line) {
				smoothCoords(true);
			}
			subline.feature = turf.bezierSpline(turf.lineString(coordinates), {sharpness: .4});
		}

		return turf.getCoords(subline.feature);
	})), {color: line.color, width: 8});

	// Make sure the last and first coords are equal if loop is true
	if (line.loop) {
		var coords = turf.getCoords(line.feature);
		coords.push(coords[0]);
	}

	// Set station offsets
	var start = stationLookup[line.stations[0]];
	line.stationOffsets = stations.slice(0, -1).map(function(station) {
		return turf.length(turf.lineSlice(
			turf.point(start.coords),
			turf.point(stationLookup[station].coords),
		line.feature));
	});

	// Make sure the last offset is equal to the length
	line.stationOffsets.push(turf.length(line.feature));

	return line.feature;
}));


var carCollection = turf.featureCollection([]);

map.once('load', function () {
	document.getElementById('loader').style.display = 'none';
});

map.once('styledata', function () {
	map.getStyle().layers.forEach(function(layer) {
		if (layer.type === 'symbol') {
			map.setLayoutProperty(layer.id, 'visibility', 'none');
		}
	});
	map.addLayer({
		id: 'lines',
		type: 'line',
		source: {
			type: 'geojson',
			data: lineCollection
		},
		paint: {
			'line-color': ['get', 'color'],
			'line-width': ['get', 'width']
		},
	});
	map.addLayer({
		id: 'stations',
		type: 'fill',
		source: {
			type: 'geojson',
			data: stationCollection
		},
		paint: {
			'fill-color': ['get', 'color'],
			'fill-opacity': .7
		},
	});
	map.addLayer({
		id: 'stations-outline',
		type: 'line',
		source: {
			type: 'geojson',
			data: stationCollection
		},
		paint: {
			'line-color': ['get', 'outlineColor'],
			'line-width': ['get', 'width']
		},
	});
	map.addLayer({
		id: 'cars',
		type: 'fill-extrusion',
		source: {
			type: 'geojson',
			data: carCollection
		},
		paint: {
			'fill-extrusion-color': ['get', 'color'],
			'fill-extrusion-height': ['interpolate', ['exponential', 0.5], ['zoom'], 0, 1638400, 19, 3.125],
			'fill-extrusion-opacity': .9
		},
	});

	carCollection = turf.featureCollection(carData.cars.map(function(car) {
		var line = lineLookup[car.line];
		var stationOffsets = line.stationOffsets;
		var sectionIndex = car.sectionIndex;
		var direction = car.direction;
		var offset = stationOffsets[sectionIndex];
		var length = stationOffsets[sectionIndex + direction] - offset;
		var feature = turf.polygon([[[0,0],[1,0],[1,1],[0,0]]], {color: line.color});

		function repeat() {
			animate(function(t) {
				var p = getPointAndBearing(line.feature, offset + t * length, direction);
				var size = Math.pow(2, 14 - map.getZoom()) * .1;
				feature.geometry = turf.getGeom(turf.transformRotate(turf.polygon([[
					turf.getCoord(turf.transformTranslate(p.point, size, -150)),
					turf.getCoord(turf.transformTranslate(p.point, size, -30)),
					turf.getCoord(turf.transformTranslate(p.point, size, 30)),
					turf.getCoord(turf.transformTranslate(p.point, size, 150)),
					turf.getCoord(turf.transformTranslate(p.point, size, -150))
				]]), p.bearing, {pivot: p.point}));
				car.coords = turf.getCoord(p.point);
				car.bearing = p.bearing;
			}, function() {
				sectionIndex = sectionIndex + direction;
				if (sectionIndex <= 0 || sectionIndex >= stationOffsets.length - 1) {
					direction = -direction;
				}
				offset = stationOffsets[sectionIndex];
				length = stationOffsets[sectionIndex + direction] - offset;

				// Stop at station
				delay(repeat, 1000);
			}, 5000 * Math.abs(length));
		}
		repeat();
		return feature;
	}));

	function refresh(timestamp) {
		map.getSource('cars').setData(carCollection);
		if (trackedCar !== undefined) {
			map.panTo(carData.cars[trackedCar].coords, {animate: false});
			map.rotateTo((timestamp / 100) % 360, {animate: false});
		}
		requestAnimationFrame(refresh);
	}
	refresh(0);
});

});

function getPointAndBearing(line, distance, direction) {
	var p1 = turf.along(line, distance);
	var delta = distance >= 1e-6 ? -1e-6 : 1e-6;
	var p2 = turf.along(line, distance + delta);

	return {
		point: p1,
		bearing: direction * delta > 0 ? turf.bearing(p1, p2) : turf.bearing(p2, p1)
	};
}

function easeSin(t) {
	return -(Math.cos(Math.PI * t) - 1) / 2;
}

function animate(callback, endCallback, duration) {
	var start;
	var frameRefresh = function() {
		var now = performance.now();
		var t;

		start = start || now;
		t = Math.min((now - start) / duration, 1);
		if (callback) {
			callback(easeSin(t));
		}
		if (t < 1) {
			requestAnimationFrame(frameRefresh);
		} else if (endCallback) {
			endCallback();
		}
	};
	requestAnimationFrame(frameRefresh);
}

function delay(callback, duration) {
	animate(null, callback, duration);
}

function concat(arr) {
	return Array.prototype.concat.apply([], arr);
}

function inRange(value, start, end) {
	return value >= start && value < end;
}

function loadJSON(url) {
	return new Promise(function(resolve, reject) {
		var request = new XMLHttpRequest();

		request.open("GET", url);
		request.onreadystatechange = function() {
			if (request.readyState === 4) {
				if (request.status === 200) {
					resolve(JSON.parse(request.response));
				} else {
					reject(Error(request.statusText));
				}
			}
		}
		request.send();
	});
}

function getLang() {
	var match = location.search.match(/lang=(.*?)(&|$)/);
	var lang = match ? decodeURIComponent(match[1]).substring(0, 2) : '';

	if (lang.match(/ja|en|ko|zh/)) {
		return lang;
	}

	lang = (window.navigator.languages && window.navigator.languages[0]) ||
		window.navigator.language ||
		window.navigator.userLanguage ||
		window.navigator.browserLanguage || '';
	lang = lang.substring(0, 2);

	return lang.match(/ja|en|ko|zh/) ? lang : 'en';
}