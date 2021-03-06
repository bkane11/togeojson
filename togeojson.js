var toGeoJSON = (function() {
    'use strict';

    var removeSpace = (/\s*/g),
        trimSpace = (/^\s*|\s*$/g),
        splitSpace = (/\s+/);
    // generate a short, numeric hash of a string
    function okhash(x) {
        if (!x || !x.length) return 0;
        for (var i = 0, h = 0; i < x.length; i++) {
            h = ((h << 5) - h) + x.charCodeAt(i) | 0;
        } return h;
    }
    // all Y children of X
    function get(x, y) { return x.getElementsByTagName(y); }
    function attr(x, y) { return x.getAttribute(y); }
    function attrf(x, y) { return parseFloat(attr(x, y)); }
    // one Y child of X, if any, otherwise null
    function get1(x, y) { var n = get(x, y); return n.length ? n[0] : null; }
    // https://developer.mozilla.org/en-US/docs/Web/API/Node.normalize
    function norm(el) { if (el.normalize) { el.normalize(); } return el; }
    // cast array x into numbers
    function numarray(x) {
        for (var j = 0, o = []; j < x.length; j++) { o[j] = parseFloat(x[j]); }
        return o;
    }
    function clean(x) {
        var o = {};
        for (var i in x) { if (x[i]) { o[i] = x[i]; } }
        return o;
    }
    // get the content of a text node, if any
    function nodeVal(x) {
        if (x) { norm(x); }
        return (x && x.firstChild && x.firstChild.nodeValue) || '';
    }
    // get one coordinate from a coordinate array, if any
    function coord1(v) { return numarray(v.replace(removeSpace, '').split(',')); }
    // get all coordinates from a coordinate array as [[],[]]
    function coord(v) {
        var coords = v.replace(trimSpace, '').split(splitSpace),
            o = [];
        for (var i = 0; i < coords.length; i++) {
            o.push(coord1(coords[i]));
        }
        return o;
    }
    function coordPair(x) {
        var ll = [attrf(x, 'lon'), attrf(x, 'lat')],
            ele = get1(x, 'ele'),
            // handle namespaced attribute in browser
            heartRate = get1(x, 'gpxtpx:hr') || get1(x, 'hr'),
            time = get1(x, 'time'),
            e;
        if (ele) {
            e = parseFloat(nodeVal(ele));
            if (e) {
              ll.push(e);
            }
        }
        return {
            coordinates: ll,
            time: time ? nodeVal(time) : null,
            heartRate: heartRate ? parseFloat(nodeVal(heartRate)) : null
        };
    }

    // create a new feature collection parent object
    function fc() {
        return {
            type: 'FeatureCollection',
            features: []
        };
    }

    var serializer
    , domparser
    ;
    if (typeof XMLSerializer !== 'undefined') {
        serializer = new XMLSerializer();
    // only require xmldom in a node environment
    } else if (typeof exports === 'object' && typeof process === 'object' && !process.browser) {
        serializer = new (require('xmldom')).XMLSerializer();
        domparser = typeof DOMParser === 'undefined' ? new (require('xmldom').DOMParser)() : DOMParser; 
    }
    function xml2str(str) {
        console.dir(str);
        // IE9 will create a new XMLSerializer but it'll crash immediately.
        if (str.xml !== undefined) return str.xml;
        return serializer.serializeToString(str);
    }

    function str2xml(str) {
        return domparser.parseFromString(str);
    }


    function setPropertiesFromDescription(properties, description){
        if( /<table/i.test(description) ){
            var propsArr = getPropsFromTable(description);
            if(propsArr && propsArr.length > 0){  
                propsArr.forEach(function(prop){
                  updateProps(properties, prop);
                })
            }
        }
    }

    function updateProps(properties, props){
      for(var prop in props){
        // printjson(['updating', prop])
        var og = properties[prop];
        if(og)
          properties['og_'+prop] = og;
        properties[prop] = props[prop];
      }
      return properties
    }

    function getPropsFromTable(table){
      return table.split(/<tr(.*)>/g)
          .map(function(item){
            return item && item.trim()
          })
          .filter(function(item){
              return item && /<td(.*)>/g.test( item )
          })
          .map(function(s2, i){
            var a = s2
              .replace(/<\/tr>/g, '')
              .replace(/<(\/)?td>/g, '')
              .replace(/\r/g, '')
              .trim()
              .split(/\n/)
              .map(function(item, index, arr){
                return arr.length == 2 ? item : null
              })
              .filter(function(item){
                return item
              })
            if(a.length == 2){
              var props = {};
              props[a[0]] = a[1];
              return props
            }
            return null
        }).filter(function(item){
          return item
        })
    }

    var t = {
        kml: function(doc) {

            var gj = fc(),
                // styleindex keeps track of hashed styles in order to match features
                styleIndex = {},
                // stylemapindex is like styleindex, but for stylemaps
                stylemapIndex = {},
                // atomic geospatial types supported by KML - MultiGeometry is
                // handled separately
                geotypes = ['Polygon', 'LineString', 'Point', 'Track', 'gx:Track', 'LatLonBox'],
                // all root placemarks in the file
                placemarks = get(doc, 'Placemark'),
                styles = get(doc, 'Style'),
                stylemaps = get(doc, 'StyleMap'),
                groundOverlays = get(doc, 'GroundOverlay')
                ;
            for (var k = 0; k < styles.length; k++) {
                styleIndex['#' + attr(styles[k], 'id')] = okhash(xml2str(styles[k])).toString(16);
            }
            for (var j = 0; j < stylemaps.length; j++) {
                var val = nodeVal(get1(stylemaps[j], 'styleUrl'));
                stylemapIndex['#' + attr(stylemaps[j], 'id')] = val;
            }
            for (var k = 0; k < placemarks.length; k++) {
                gj.features = gj.features.concat(getPlacemark(placemarks[k]));
            }
            for (var l = 0; l < groundOverlays.length; l++) {
                gj.features = gj.features.concat(getPlacemark(groundOverlays[l]));
            }
            // kmlcolor format AABBGGRR
            function kmlColor(v) {
                var color, opacity;
                v = v || "";
                if (v.substr(0, 1) === "#") { v = v.substr(1); }
                if (v.length === 6 || v.length === 3) { color = v; }
                if (v.length === 8) {
                    // opacity = parseInt(v.substr(6), 16) / 255;
                    // color = v.substr(0,6);
                    var colorparts = v.substr(2)
                        // reverse - from bbggrr to rrggbb
                        .split('');

                    opacity = parseInt(v.substr(0, 2), 16) / 255;                    
                    color = [].concat.call([
                            colorparts.slice(4,6)//.reverse()
                            , colorparts.slice(2,4)//.reverse()
                            , colorparts.slice(0,2)//.reverse()
                        ]).map(function(item){ return item.join('') })
                        .join('')
                    ;

                }
                return [color && '#' +  color, isNaN(opacity) ? undefined : opacity];
            }
            // function kmlIcon(v){}
            function gxCoord(v) { return numarray(v.split(' ')); }
            function gxCoords(root) {
                var elems = get(root, 'coord', 'gx'), coords = [], times = [];
                if (elems.length === 0) elems = get(root, 'gx:coord');
                for (var i = 0; i < elems.length; i++) coords.push(gxCoord(nodeVal(elems[i])));
                var timeElems = get(root, 'when');
                for (var i = 0; i < timeElems.length; i++) times.push(nodeVal(timeElems[i]));
                return {
                    coords: coords,
                    times: times
                };
            }
            function getGeometry(root) {
                var geomNode, geomNodes, i, j, k, geoms = [], coordTimes = [];
                if (get1(root, 'MultiGeometry')) { return getGeometry(get1(root, 'MultiGeometry')); }
                if (get1(root, 'MultiTrack')) { return getGeometry(get1(root, 'MultiTrack')); }
                if (get1(root, 'gx:MultiTrack')) { return getGeometry(get1(root, 'gx:MultiTrack')); }
                for (i = 0; i < geotypes.length; i++) {
                    geomNodes = get(root, geotypes[i]);
                    if (geomNodes) {
                        for (j = 0; j < geomNodes.length; j++) {
                            geomNode = geomNodes[j];
                            // console.log(geotypes[i])
                            if (geotypes[i] === 'Point') {
                                geoms.push({
                                    type: 'Point',
                                    coordinates: coord1(nodeVal(get1(geomNode, 'coordinates')))
                                });
                            } else if (geotypes[i] === 'LineString') {
                                geoms.push({
                                    type: 'LineString',
                                    coordinates: coord(nodeVal(get1(geomNode, 'coordinates')))
                                });
                            } else if (geotypes[i] === 'Polygon') {
                                var rings = get(geomNode, 'LinearRing'),
                                    coords = [];
                                for (k = 0; k < rings.length; k++) {
                                    coords.push(coord(nodeVal(get1(rings[k], 'coordinates'))));
                                }
                                geoms.push({
                                    type: 'Polygon',
                                    coordinates: coords
                                });
                                // console.log('polygon')
                            }else if (geotypes[i] === 'LatLonBox') {
                                // var rings = get(geomNode, 'LinearRing'),
                                var west = parseFloat(nodeVal(get1(geomNode, 'west')))
                                , south = parseFloat(nodeVal(get1(geomNode, 'south')))
                                , east = parseFloat(nodeVal(get1(geomNode, 'east')))
                                , north = parseFloat(nodeVal(get1(geomNode, 'north')))
                                , coords = [[ [west, south], [west, north], [east, north], [east, south], [west, south] ]]
                                ;

                                geoms.push({
                                    type: 'Polygon',
                                    bbox: [west, south, east, north],
                                    coordinates: coords
                                });
                                // console.log('polygon')
                            } else if (geotypes[i] === 'Track' ||
                                geotypes[i] === 'gx:Track') {
                                var track = gxCoords(geomNode);
                                geoms.push({
                                    type: 'LineString',
                                    coordinates: track.coords
                                });
                                if (track.times.length) coordTimes.push(track.times);
                            }
                        }
                    }
                }
                return {
                    geoms: geoms,
                    coordTimes: coordTimes
                };
            }
            function getPlacemark(root) {
                var geomsAndTimes = getGeometry(root), i, properties = {},
                    name = nodeVal(get1(root, 'name')),
                    styleUrl = nodeVal(get1(root, 'styleUrl')),
                    // styleMap = nodeVal(get1(root, 'StyleMap')),
                    description = nodeVal(get1(root, 'description')),
                    timeSpan = get1(root, 'TimeSpan'),
                    extendedData = get1(root, 'ExtendedData'),
                    lineStyle = get1(root, 'LineStyle'),
                    polyStyle = get1(root, 'PolyStyle'),
                    iconStyle = get1(root, 'IconStyle') || get1(root, 'Icon')
                    ;
                
                if (!geomsAndTimes.geoms.length) return [];
                if (name) properties.name = name;

                var lookupstyle;
                if (styleUrl && (lookupstyle = (styleIndex[styleUrl] || stylemapIndex[styleUrl]) ) ) {
                    properties.styleUrl = styleUrl;
                    properties.styleHash = lookupstyle;
                    if(lookupstyle){
                        // console.log(styleUrl, lookupstyle);
                        for (var i = 0, len = styles.length; i < len; i++) {
                            var el = styles[i];
                            if( !!~[lookupstyle, styleUrl].indexOf('#' + attr(el, 'id') ) ){
                            // if('#' + attr(el, 'id')===lookupstyle){
                                var nv = nodeVal ( el );
                                var tempdom = str2xml( nv )
                                lineStyle = get1(tempdom, 'LineStyle');
                                polyStyle = get1(tempdom, 'PolyStyle');
                                iconStyle = get1(tempdom, 'IconStyle');
                            }
                        }
                    }
                }
                if (description){
                    if( /<table/i.test(description) )
                        setPropertiesFromDescription(properties, description)
                    else
                        properties.description = description;
                }
                if (timeSpan) {
                    var begin = nodeVal(get1(timeSpan, 'begin'));
                    var end = nodeVal(get1(timeSpan, 'end'));
                    properties.timespan = { begin: begin, end: end };
                }
                if(iconStyle){
                    // console.log(iconStyle, name)
                    // iconUrl = nodeVal(get1(iconStyle, 'href'));
                    // properties.iconScale = nodeVal(get1(iconStyle, 'scale'));
                    var hotspot = get1(iconStyle, 'hotSpot');
                    properties.icon = {
                        url: nodeVal(get1(iconStyle, 'href'))
                        , scale: nodeVal(get1(iconStyle, 'scale'))
                        , color: nodeVal(get1(iconStyle, 'color'))
                    }
                    
                    if(hotspot)
                        properties.icon.hotspot = {
                            x: attr(hotspot, 'x')
                            , y: attr(hotspot, 'y')
                            , xunits: attr(hotspot, 'xunits')
                            , yunits: attr(hotspot, 'yunits')
                        }
                    // properties.iconHotSpot = {
                    //     x: attr(hotspot, 'x')
                    //     , y: attr(hotspot, 'y')
                    //     , xunits: attr(hotspot, 'xunits')
                    //     , yunits: attr(hotspot, 'yunits')
                    // }
                }

                if (lineStyle) {
                    // console.log(lineStyle)
                    var linestyles = kmlColor(nodeVal(get1(lineStyle, 'color'))),
                        color = linestyles[0],
                        opacity = linestyles[1],
                        width = parseFloat(nodeVal(get1(lineStyle, 'width')));
                    // console.log(linestyles);
                    if (color) properties.stroke = color;
                    if (!isNaN(opacity)) properties['stroke-opacity'] = opacity;
                    if (!isNaN(width)) properties['stroke-width'] = width;
                }
                if (polyStyle) {
                    // console.log(polyStyle)
                    var polystyles = kmlColor(nodeVal(get1(polyStyle, 'color'))),
                        pcolor = polystyles[0],
                        popacity = polystyles[1],
                        fill = nodeVal(get1(polyStyle, 'fill')),
                        outline = nodeVal(get1(polyStyle, 'outline'));
                    if (pcolor) properties.fill = pcolor;
                    if (!isNaN(popacity)) properties['fill-opacity'] = popacity;
                    if (fill) properties['fill-opacity'] = fill === "1" ? 1 : 0;
                    if (outline && !properties['stroke-opacity']) 
                        properties['stroke-opacity'] = outline === "1" ? 1 : 0;
                }
                if (extendedData) {
                    var datas = get(extendedData, 'Data'),
                        simpleDatas = get(extendedData, 'SimpleData');

                    for (i = 0; i < datas.length; i++) {
                        properties[datas[i].getAttribute('name')] = nodeVal(get1(datas[i], 'value'));
                    }
                    for (i = 0; i < simpleDatas.length; i++) {
                        properties[simpleDatas[i].getAttribute('name')] = nodeVal(simpleDatas[i]);
                    }
                }
                if (geomsAndTimes.coordTimes.length) {
                    properties.coordTimes = (geomsAndTimes.coordTimes.length === 1) ?
                        geomsAndTimes.coordTimes[0] : geomsAndTimes.coordTimes;
                }

                var types = geomsAndTimes.geoms
                    .map(function(a){ return a.type} )
                    .reduce(function(last, current){
                        var re = new RegExp(current, 'i');
                        if( !re.test(last) )
                            last += ',' + current
                        return last
                })

                if(/(polygon|point)/i.test(types)){
                    console.log( 'type:', types)
                }

                if(geomsAndTimes.geoms.length>1){
                    var features = [];
                    geomsAndTimes.geoms.forEach(function(item){
                        features.push({
                            type: 'Feature'
                            , geometry: item
                            , properties: properties
                        })
                    })
                    return features
                }else{
                    var feature = {
                        type: 'Feature',
                        geometry: (geomsAndTimes.geoms.length === 1) ? geomsAndTimes.geoms[0] : {
                            type: 'GeometryCollection',
                            geometries: geomsAndTimes.geoms
                        },
                        properties: properties
                    };
                }
                
                var id = attr(root, 'id');
                if(id)
                    feature.id = attr(root, 'id');


                return [feature];
            }
            return gj;
        },
        gpx: function(doc) {
            var i,
                tracks = get(doc, 'trk'),
                routes = get(doc, 'rte'),
                waypoints = get(doc, 'wpt'),
                // a feature collection
                gj = fc(),
                feature;
            for (i = 0; i < tracks.length; i++) {
                feature = getTrack(tracks[i]);
                if (feature) gj.features.push(feature);
            }
            for (i = 0; i < routes.length; i++) {
                feature = getRoute(routes[i]);
                if (feature) gj.features.push(feature);
            }
            for (i = 0; i < waypoints.length; i++) {
                gj.features.push(getPoint(waypoints[i]));
            }
            function getPoints(node, pointname) {
                var pts = get(node, pointname),
                    line = [],
                    times = [],
                    heartRates = [],
                    l = pts.length;
                if (l < 2) return {};  // Invalid line in GeoJSON
                for (var i = 0; i < l; i++) {
                    var c = coordPair(pts[i]);
                    line.push(c.coordinates);
                    if (c.time) times.push(c.time);
                    if (c.heartRate) heartRates.push(c.heartRate);
                }
                return {
                    line: line,
                    times: times,
                    heartRates: heartRates
                };
            }
            function getTrack(node) {
                var segments = get(node, 'trkseg'),
                    track = [],
                    times = [],
                    heartRates = [],
                    line;
                for (var i = 0; i < segments.length; i++) {
                    line = getPoints(segments[i], 'trkpt');
                    if (line.line) track.push(line.line);
                    if (line.times && line.times.length) times.push(line.times);
                    if (line.heartRates && line.heartRates.length) heartRates.push(line.heartRates);
                }
                if (track.length === 0) return;
                var properties = getProperties(node);
                if (times.length) properties.coordTimes = track.length === 1 ? times[0] : times;
                if (heartRates.length) properties.heartRates = track.length === 1 ? heartRates[0] : heartRates;
                return {
                    type: 'Feature',
                    properties: properties,
                    geometry: {
                        type: track.length === 1 ? 'LineString' : 'MultiLineString',
                        coordinates: track.length === 1 ? track[0] : track
                    }
                };
            }
            function getRoute(node) {
                var line = getPoints(node, 'rtept');
                if (!line) return;
                var routeObj = {
                    type: 'Feature',
                    properties: getProperties(node),
                    geometry: {
                        type: 'LineString',
                        coordinates: line
                    }
                };
                if (line.times.length) routeObj.geometry.times = line.times;
                return routeObj;
            }
            function getPoint(node) {
                var prop = getProperties(node);
                prop.sym = nodeVal(get1(node, 'sym'));
                return {
                    type: 'Feature',
                    properties: prop,
                    geometry: {
                        type: 'Point',
                        coordinates: coordPair(node).coordinates
                    }
                };
            }
            function getProperties(node) {
                var meta = ['name', 'desc', 'author', 'copyright', 'link',
                            'time', 'keywords'],
                    prop = {},
                    k;
                for (k = 0; k < meta.length; k++) {
                    prop[meta[k]] = nodeVal(get1(node, meta[k]));
                }
                return clean(prop);
            }
            return gj;
        }
    };
    return t;
})();

if (typeof module !== 'undefined') module.exports = toGeoJSON;
