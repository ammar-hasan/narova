'use strict';

// High-freedom discovery sources. These are intentionally not API adapters:
// an LLM/browser must inspect the current item page, rights, and download.
const BROWSER_PROVIDERS = Object.freeze([
  // Photography and video
  ['pexels-web', 'Pexels website', ['image', 'video'], 'https://www.pexels.com/', 'photo-video'],
  ['unsplash', 'Unsplash', ['image'], 'https://unsplash.com/', 'photo-video'],
  ['pixabay-web', 'Pixabay website', ['image', 'video'], 'https://pixabay.com/', 'photo-video'],
  ['flickr', 'Flickr', ['image'], 'https://www.flickr.com/', 'photo-video'],
  ['noaa-media', 'NOAA Media', ['image', 'video'], 'https://www.noaa.gov/multimedia', 'photo-video'],
  ['nasa-earth-observatory', 'NASA Earth Observatory', ['image'], 'https://earthobservatory.nasa.gov/images', 'photo-video'],
  ['nasa-jpl-media', 'NASA JPL Images', ['image', 'video'], 'https://www.jpl.nasa.gov/images/', 'photo-video'],
  ['mixkit-video', 'Mixkit Video', ['video'], 'https://mixkit.co/free-stock-video/', 'photo-video'],
  ['coverr', 'Coverr', ['video'], 'https://coverr.co/', 'photo-video'],

  // Music and sound effects
  ['mixkit-music', 'Mixkit Music', ['audio'], 'https://mixkit.co/free-stock-music/', 'audio'],
  ['pixabay-music', 'Pixabay Music', ['audio'], 'https://pixabay.com/music/', 'audio'],
  ['incompetech', 'Incompetech', ['audio'], 'https://incompetech.com/music/', 'audio'],
  ['free-music-archive', 'Free Music Archive', ['audio'], 'https://freemusicarchive.org/', 'audio'],
  ['ccmixter', 'ccMixter', ['audio'], 'https://ccmixter.org/', 'audio'],
  ['freepd', 'FreePD', ['audio'], 'https://freepd.com/', 'audio'],
  ['purple-planet', 'Purple Planet', ['audio'], 'https://www.purple-planet.com/', 'audio'],
  ['teknoaxe', 'TeknoAXE', ['audio'], 'https://teknoaxe.com/', 'audio'],
  ['jamendo', 'Jamendo', ['audio'], 'https://www.jamendo.com/', 'audio'],
  ['liborio-conti', 'Liborio Conti', ['audio'], 'https://www.no-copyright-music.com/', 'audio'],
  ['mixkit-sfx', 'Mixkit Sound Effects', ['audio'], 'https://mixkit.co/free-sound-effects/', 'audio'],
  ['pixabay-sfx', 'Pixabay Sound Effects', ['audio'], 'https://pixabay.com/sound-effects/', 'audio'],
  ['kenney-audio', 'Kenney Audio', ['audio'], 'https://kenney.nl/assets/category:Audio', 'audio'],
  ['bbc-sfx', 'BBC Sound Effects', ['audio'], 'https://sound-effects.bbcrewind.co.uk/', 'audio'],
  ['open-game-art', 'OpenGameArt', ['image', 'audio', 'model'], 'https://opengameart.org/', 'audio'],

  // Fonts, 2D icons, and illustration
  ['google-fonts', 'Google Fonts', ['font'], 'https://fonts.google.com/', '2d-font'],
  ['bunny-fonts', 'Bunny Fonts', ['font'], 'https://fonts.bunny.net/', '2d-font'],
  ['fontsource', 'Fontsource', ['font'], 'https://fontsource.org/', '2d-font'],
  ['font-squirrel', 'Font Squirrel', ['font'], 'https://www.fontsquirrel.com/', '2d-font'],
  ['dafont', 'DaFont', ['font'], 'https://www.dafont.com/', '2d-font'],
  ['simple-icons', 'Simple Icons', ['image'], 'https://simpleicons.org/', '2d-font'],
  ['lucide', 'Lucide', ['image'], 'https://lucide.dev/', '2d-font'],
  ['tabler-icons', 'Tabler Icons', ['image', 'font'], 'https://tabler.io/icons', '2d-font'],
  ['ionicons', 'Ionicons', ['image', 'font'], 'https://ionic.io/ionicons', '2d-font'],
  ['boxicons', 'Boxicons', ['image', 'font'], 'https://boxicons.com/', '2d-font'],
  ['octicons', 'GitHub Octicons', ['image'], 'https://primer.style/octicons/', '2d-font'],
  ['feather', 'Feather Icons', ['image'], 'https://feathericons.com/', '2d-font'],
  ['phosphor', 'Phosphor Icons', ['image'], 'https://phosphoricons.com/', '2d-font'],
  ['bootstrap-icons', 'Bootstrap Icons', ['image', 'font'], 'https://icons.getbootstrap.com/', '2d-font'],
  ['remix-icon', 'Remix Icon', ['image', 'font'], 'https://remixicon.com/', '2d-font'],
  ['flagcdn', 'FlagCDN', ['image'], 'https://flagcdn.com/', '2d-font'],
  ['country-flag-icons', 'Country Flag Icons', ['image'], 'https://catamphetamine.gitlab.io/country-flag-icons/', '2d-font'],
  ['mapsicon', 'Mapsicon', ['image'], 'https://github.com/djaiss/mapsicon', '2d-font'],
  ['undraw', 'unDraw', ['image'], 'https://undraw.co/illustrations', '2d-font'],
  ['drawkit', 'DrawKit', ['image'], 'https://www.drawkit.com/', '2d-font'],
  ['open-doodles', 'Open Doodles', ['image'], 'https://www.opendoodles.com/', '2d-font'],
  ['manypixels', 'ManyPixels Gallery', ['image'], 'https://www.manypixels.co/gallery', '2d-font'],
  ['lukasz-adam', 'Lukasz Adam Illustrations', ['image'], 'https://lukaszadam.com/illustrations', '2d-font'],
  ['bioicons', 'Bioicons', ['image'], 'https://bioicons.com/', '2d-font'],
  ['isoflat', 'Isoflat', ['image'], 'https://isoflat.com/', '2d-font'],

  // 3D, textures, and HDRIs
  ['poly-haven-library', 'Poly Haven textures and HDRIs', ['image', 'hdri', 'model'], 'https://polyhaven.com/', '3d'],
  ['ambientcg', 'ambientCG', ['image', 'hdri', 'model'], 'https://ambientcg.com/', '3d'],
  ['kenney-3d', 'Kenney 3D', ['model'], 'https://kenney.nl/assets/category:3D', '3d'],
  ['quaternius', 'Quaternius', ['model'], 'https://quaternius.com/', '3d'],
  ['sketchfab', 'Sketchfab downloadable CC assets', ['model'], 'https://sketchfab.com/', '3d'],
  ['nasa-3d', 'NASA 3D Resources', ['model'], 'https://nasa3d.arc.nasa.gov/', '3d'],
  ['smithsonian-3d', 'Smithsonian Open Access 3D', ['model'], 'https://3d.si.edu/', '3d'],

  // Museums, libraries, and cultural collections
  ['smithsonian', 'Smithsonian Open Access', ['image', 'model'], 'https://www.si.edu/openaccess', 'culture'],
  ['artic', 'Art Institute of Chicago', ['image'], 'https://www.artic.edu/open-access/open-access-images', 'culture'],
  ['wellcome', 'Wellcome Collection', ['image'], 'https://wellcomecollection.org/works', 'culture'],
  ['rijksmuseum', 'Rijksmuseum', ['image'], 'https://www.rijksmuseum.nl/en/rijksstudio', 'culture'],
  ['nga', 'National Gallery of Art', ['image'], 'https://www.nga.gov/open-access-images.html', 'culture'],
  ['smk', 'National Gallery of Denmark', ['image'], 'https://open.smk.dk/', 'culture'],
  ['europeana', 'Europeana', ['image', 'audio', 'video'], 'https://www.europeana.eu/', 'culture'],
  ['nypl', 'NYPL Digital Collections', ['image'], 'https://digitalcollections.nypl.org/', 'culture'],
  ['biodiversity-heritage-library', 'Biodiversity Heritage Library', ['image'], 'https://www.biodiversitylibrary.org/', 'culture'],
  ['v-and-a', 'V&A Collections', ['image'], 'https://collections.vam.ac.uk/', 'culture'],
  ['te-papa', 'Te Papa Collections', ['image'], 'https://collections.tepapa.govt.nz/', 'culture'],
  ['science-museum-group', 'Science Museum Group Collection', ['image'], 'https://collection.sciencemuseumgroup.org.uk/', 'culture'],
  ['natural-history-museum', 'Natural History Museum Data', ['image', 'data'], 'https://data.nhm.ac.uk/', 'culture'],

  // Maps, geography, science, and nature
  ['openstreetmap', 'OpenStreetMap', ['map', 'data'], 'https://www.openstreetmap.org/', 'data'],
  ['openstreetmap-de', 'OpenStreetMap Germany tiles', ['map'], 'https://openstreetmap.de/', 'data'],
  ['wikimedia-osm', 'Wikimedia OSM tiles', ['map'], 'https://maps.wikimedia.org/', 'data'],
  ['cartodb', 'Carto basemaps', ['map'], 'https://carto.com/basemaps/', 'data'],
  ['opentopomap', 'OpenTopoMap', ['map'], 'https://opentopomap.org/', 'data'],
  ['thunderforest', 'Thunderforest Maps', ['map'], 'https://www.thunderforest.com/maps/', 'data'],
  ['esri-world-imagery', 'Esri World Imagery', ['map', 'image'], 'https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9', 'data'],
  ['nominatim', 'Nominatim', ['data'], 'https://nominatim.openstreetmap.org/', 'data'],
  ['geo-countries', 'Geo Countries boundary data', ['map', 'data'], 'https://github.com/datasets/geo-countries', 'data'],
  ['natural-earth', 'Natural Earth', ['map', 'data'], 'https://www.naturalearthdata.com/', 'data'],
  ['gadm', 'GADM', ['map', 'data'], 'https://gadm.org/', 'data'],
  ['open-meteo', 'Open-Meteo', ['data'], 'https://open-meteo.com/', 'data'],
  ['noaa-weather', 'NOAA Weather', ['image', 'data'], 'https://www.weather.gov/', 'data'],
  ['noaa-weather-icons', 'NOAA Weather icons', ['image'], 'https://api.weather.gov/icons', 'data'],
  ['sunrise-sunset', 'Sunrise-Sunset', ['data'], 'https://sunrise-sunset.org/api', 'data'],
  ['7timer', '7Timer', ['image', 'data'], 'https://www.7timer.info/', 'data'],
  ['usgs-earthquakes', 'USGS Earthquakes', ['map', 'data'], 'https://earthquake.usgs.gov/earthquakes/feed/', 'data'],
  ['encyclopedia-of-life', 'Encyclopedia of Life', ['image', 'data'], 'https://eol.org/', 'data'],
  ['inaturalist', 'iNaturalist', ['image', 'data'], 'https://www.inaturalist.org/', 'data'],
  ['gbif', 'GBIF', ['image', 'data'], 'https://www.gbif.org/', 'data'],
  ['obis', 'OBIS', ['data'], 'https://obis.org/', 'data'],
  ['where-the-iss', 'Where the ISS at', ['data'], 'https://wheretheiss.at/', 'data'],
  ['space-devs', 'The Space Devs', ['image', 'data'], 'https://thespacedevs.com/', 'data'],
  ['nasa-eonet', 'NASA EONET', ['image', 'data'], 'https://eonet.gsfc.nasa.gov/', 'data'],
  ['nasa-apod-neo', 'NASA APOD and NEO', ['image', 'data'], 'https://api.nasa.gov/', 'data'],
  ['jpl-small-body', 'JPL Small-Body Database', ['data'], 'https://ssd.jpl.nasa.gov/tools/sbdb_lookup.html', 'data'],

  // Explicitly non-production
  ['lorem-picsum', 'Lorem Picsum', ['image'], 'https://picsum.photos/', 'placeholder'],
  ['lorem-flickr', 'LoremFlickr', ['image'], 'https://loremflickr.com/', 'placeholder'],
  ['placehold-co', 'placehold.co', ['image'], 'https://placehold.co/', 'placeholder'],
  ['dummyimage', 'DummyImage', ['image'], 'https://dummyimage.com/', 'placeholder'],
  ['placebear', 'PlaceBear', ['image'], 'https://placebear.com/', 'placeholder'],
  ['jsonplaceholder-photos', 'JSONPlaceholder Photos', ['image', 'data'], 'https://jsonplaceholder.typicode.com/photos', 'placeholder'],
].map(([id, name, kinds, url, category]) => Object.freeze({
  id, name, kinds: Object.freeze(kinds), url, category, mode: 'llm-browser', ready: false,
})));

function listBrowserProviders() {
  return BROWSER_PROVIDERS.map(provider => ({ ...provider, kinds: [...provider.kinds] }));
}

module.exports = { BROWSER_PROVIDERS, listBrowserProviders };
