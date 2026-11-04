/**
 * Commons' `extmetadata` for five pictures the catalogue shows, as the API
 * answered on 2026-11-04 (#2346): free-form author fields whose credits
 * reached the line raw (a template's sentence, an e-mail address, the licence
 * in the author field, a tag cut open by the input cap) and one file whose
 * photographer asked for a credit of their own (`Attribution`).
 *
 * Verbatim, because the defects were in the markup's shape; a hand-written
 * stand-in would pin the shape somebody remembered.
 */

type ExtMetadata = Record<string, { value: string }>;

/** Phuktal Monastery: `File:Phuktal Gompa Tall View Zanskar Oct22 A7C 04461.jpg`. */
export const PHUKTAL: ExtMetadata = {
  "Artist": {
    "value": "<table class=\"toccolours\" style=\"width:100%; margin-top:10px;\" cellpadding=\"2\">\n\n<tbody><tr class=\"plainlinks\">\n<td><a href=\"https://upload.wikimedia.org/wikipedia/commons/c/c9/Phuktal_Gompa_Tall_View_Zanskar_Oct22_A7C_04461.jpg?utm_source=commons.wikimedia.org&amp;utm_campaign=api&amp;utm_content=original\" class=\"internal\" title=\"Phuktal Gompa Tall View Zanskar Oct22 A7C 04461.jpg\">This Photo</a> was taken by <i><b><a href=\"//commons.wikimedia.org/wiki/User:Tagooty\" title=\"User:Tagooty\">Timothy A. Gonsalves</a></b></i>.  Feel free to use my photos, but please mention me as the author.  I would much appreciate if you send me an email <a rel=\"nofollow\" class=\"external text\" href=\"mailto:tagooty@yahoo.com\">tagooty@yahoo.com</a> or write on <a class=\"external text\" href=\"https://commons.wikimedia.org/w/index.php?title=User_talk:Tagooty&amp;action=edit&amp;section=new\">my talk page</a>, for my information.  Please contact me before commercial use.\n</td></tr></tbody></table>\n<div style=\"clear:both; border:2px solid #00cc00; background-color:#f7f7f7; margin-top:6px;\">\n<table><tbody><tr><td style=\"padding:4px;\"><span typeof=\"mw:File\"><a href=\"//commons.wikimedia.org/wiki/File:Upload-problem2.svg\" class=\"mw-file-description\"><img src=\"https://thumb.wikimedia.org/wikipedia/commons/thumb/f/f9/Upload-problem2.svg/120px-Upload-problem2.svg.png?utm_source=commons.wikimedia.org&amp;utm_campaign=parser&amp;utm_content=thumbnail\" decoding=\"async\" loading=\"lazy\" width=\"64\" height=\"57\" class=\"mw-file-element\" srcset=\"https://thumb.wikimedia.org/wikipedia/commons/thumb/f/f9/Upload-problem2.svg/250px-Upload-problem2.svg.png?utm_source=commons.wikimedia.org&amp;utm_campaign=parser&amp;utm_content=thumbnail 2x\" data-file-width=\"159\" data-file-height=\"142\"></a></span>\n</td><td style=\"padding:4px;\"><div style=\"margin-top:0.5em;\">Please do not upload an edited image here without consulting me.  I would like to make corrections only at my own source to ensure that the changes improve the image and are preserved.<br>Otherwise you may upload an edited image with a new name. Please use one of the templates <a href=\"//commons.wikimedia.org/wiki/Template:Derived_from\" title=\"Template:Derived from\">derivative</a> or <a href=\"//commons.wikimedia.org/wiki/Template:Extracted_from\" title=\"Template:Extracted from\">extract</a>.</div>\n</td></tr></tbody></table></div>"
  },
  "AttributionRequired": {
    "value": "true"
  },
  "LicenseShortName": {
    "value": "CC BY-SA 4.0"
  },
  "LicenseUrl": {
    "value": "https://creativecommons.org/licenses/by-sa/4.0"
  }
};

/** The Ipatiev Monastery: `File:Ipatiev Monastery in Kostroma.jpg`. */
export const IPATIEV: ExtMetadata = {
  "Artist": {
    "value": "<b>This photo</b> <b>was taken by</b> <i><b><a href=\"//commons.wikimedia.org/wiki/User:Nino_Verde\" title=\"User:Nino Verde\"><b>Anton Zelenov</b></a></b></i>.<br><br>\n<p><i>Please <b>credit</b> this with : </i><b>Photo : Anton Zelenov</b><i> in the immediate vicinity of the image.</i><br><br>\nIf you use one of my photos, please <a href=\"//commons.wikimedia.org/wiki/Special:EmailUser/Nino_Verde\" title=\"Special:EmailUser/Nino Verde\">email me</a> (account needed) or leave me a short message on <a href=\"//commons.wikimedia.org/wiki/User_talk:Nino_Verde\" title=\"User talk:Nino Verde\">my discussion page</a>.\nIt would be greatly appreciated.<br>\nDo not copy this image illegally by ignoring the terms of the license below, as it is not in the public domain.<br>\n</p>\nIf you would like special permission to use, license, or purchase the image please <a href=\"//commons.wikimedia.org/wiki/Special:EmailUser/Nino_Verde\" title=\"Special:EmailUser/Nino Verde\">contact me</a> to negotiate terms."
  },
  "AttributionRequired": {
    "value": "true"
  },
  "LicenseShortName": {
    "value": "CC BY-SA 3.0"
  },
  "LicenseUrl": {
    "value": "https://creativecommons.org/licenses/by-sa/3.0"
  }
};

/** Fujisan: `File:FujiSunriseKawaguchiko2025WP.jpg`. */
export const FUJI: ExtMetadata = {
  "Artist": {
    "value": "<table class=\"licensetpl\" style=\"display:none\">\n<tbody><tr>\n<td><span class=\"licensetpl_short\">Public domain</span><span class=\"licensetpl_long\">Public domain</span><span class=\"licensetpl_link_req\">false</span><span class=\"licensetpl_attr_req\">false</span>\n</td></tr></tbody></table>\n<table style=\"width: 100%; clear: both; margin: 0.5em auto; background-color: var(--background-color-progressive-subtle, #f7f8ff); color: var(--color-base, #202122); border: var(--border-subtle, 2px solid #8888aa); border-spacing: 8px; padding: 0px;\" dir=\"ltr\" class=\"layouttemplate\" lang=\"en\">\n<tbody><tr>\n<td><span typeof=\"mw:File\"><span title=\"Public domain\"><img alt=\"Public domain\" src=\"https://thumb.wikimedia.org/wikipedia/commons/thumb/6/62/PD-icon.svg/120px-PD-icon.svg.png?utm_source=commons.wikimedia.org&amp;utm_campaign=parser&amp;utm_content=thumbnail\" decoding=\"async\" loading=\"lazy\" width=\"64\" height=\"64\" class=\"mw-file-element\" srcset=\"https://thumb.wikimedia.org/wikipedia/commons/thumb/6/62/PD-icon.svg/250px-PD-icon.svg.png?utm_source=commons.wikimedia.org&amp;utm_campaign=parser&amp;utm_content=thumbnail 2x\" data-file-width=\"196\" data-file-height=\"196\"></span></span>\n</td>\n<td>I, the copyright holder of this work, release this work into the <b><a href=\"https://en.wikipedia.org/wiki/en:public_domain\" class=\"extiw\" title=\"w:en:public domain\">public domain</a></b>. This applies worldwide.<br><small>In some countries this may not be legally possible; if so:</small><br><i>I grant anyone the right to use this work <b>for any purpose</b>, without any conditions, unless such conditions are required by law.</i>\n</td></tr></tbody></table>"
  },
  "AttributionRequired": {
    "value": "false"
  },
  "LicenseShortName": {
    "value": "Public domain"
  }
};

/** Santa Maria in Vallicella: `File:Santa Maria in Vallicella Facade a Roma.jpg`. */
export const VALLICELLA: ExtMetadata = {
  "Artist": {
    "value": "<table class=\"toccolours\" style=\"width:100%; margin-top:10px;\" cellpadding=\"2\">\n\n<tbody><tr class=\"plainlinks\">\n<td><span typeof=\"mw:File\"><a href=\"//commons.wikimedia.org/wiki/File:Emblem-camera.svg\" class=\"mw-file-description\"><img src=\"https://thumb.wikimedia.org/wikipedia/commons/thumb/4/48/Emblem-camera.svg/40px-Emblem-camera.svg.png?utm_source=commons.wikimedia.org&amp;utm_campaign=parser&amp;utm_content=thumbnail\" decoding=\"async\" loading=\"lazy\" width=\"25\" height=\"25\" class=\"mw-file-element\" srcset=\"https://thumb.wikimedia.org/wikipedia/commons/thumb/4/48/Emblem-camera.svg/60px-Emblem-camera.svg.png?utm_source=commons.wikimedia.org&amp;utm_campaign=parser&amp;utm_content=thumbnail 2x\" data-file-width=\"64\" data-file-height=\"64\"></a></span>  <a href=\"https://upload.wikimedia.org/wikipedia/commons/f/f3/Santa_Maria_in_Vallicella_Facade_a_Roma.jpg?utm_source=commons.wikimedia.org&amp;utm_campaign=api&amp;utm_content=original\" class=\"internal\" title=\"Santa Maria in Vallicella Facade a Roma.jpg\">This Photo</a> was taken by <i><b><a href=\"//commons.wikimedia.org/wiki/User:Moroder\" title=\"User:Moroder\">Wolfgang Moroder</a></b></i>.  <span typeof=\"mw:File\"><a href=\"//commons.wikimedia.org/wiki/File:User_with_smile.svg\" class=\"mw-file-description\"><img src=\"https://thumb.wikimedia.org/wikipedia/commons/thumb/5/5f/User_with_smile.svg/40px-User_with_smile.svg.png?utm_source=commons.wikimedia.org&amp;utm_campaign=parser&amp;utm_content=thumbnail\" decoding=\"async\" loading=\"lazy\" width=\"25\" height=\"25\" class=\"mw-file-element\" srcset=\"https://thumb.wikimedia.org/wikipedia/commons/thumb/5/5f/User_with_smile.svg/60px-User_with_smile.svg.png?utm_source=commons.wikimedia.org&amp;utm_campaign=parser&amp;utm_content=thumbnail 2x\" data-file-width=\"128\" data-file-height=\"128\"></a></span>\n</td>\n<td align=\"right\">Feel free to use my photos, but please mention me as the author and send me a  <a class=\"external text\" data-mw-original-href=\"http://commons.wikimedia.org/w/index.php?title=User_talk:Moroder&amp;action=edit&amp;section=new\" href=\"https://commons.wikimedia.org/w/index.php?title=User_talk:Moroder&amp;action=edit&amp;section=new\">message</a>. <span typeof=\"mw:File\"><a href=\"//commons.wikimedia.org/wiki/File:Crystal_128_mail.png\" class=\"mw-file-description\"><img src=\"https://thumb.wikimedia.org/wikipedia/commons/thumb/7/7b/Crystal_128_mail.png/40px-Crystal_128_mail.png?utm_source=commons.wikimedia.org&amp;utm_campaign=parser&amp;utm_content=thumbnail\" decoding=\"async\" loading=\"lazy\" width=\"25\" height=\"25\" class=\"mw-file-element\" srcset=\"https://thumb.wikimedia.org/wikipedia/commons/thumb/7/7b/Crystal_128_mail.png/60px-Crystal_128_mail.png?utm_source=commons.wikimedia.org&amp;utm_campaign=parser&amp;utm_content=thumbnail 2x\" data-file-width=\"128\" data-file-height=\"128\"></a></span>\n</td></tr></tbody></table>\n<div style=\"clear:both; border:2px solid #cc0000; background-color:#f7f7f7; margin-top:6px;\">\n<table><tbody><tr><td style=\"padding:4px;\"><span typeof=\"mw:File\"><a href=\"//commons.wikimedia.org/wiki/File:Control_copyright_icon.svg\" class=\"mw-file-description\"><img src=\"https://thumb.wikimedia.org/wikipedia/commons/thumb/1/1b/Control_copyright_icon.svg/120px-Control_copyright_icon.svg.png?utm_source=commons.wikimedia.org&amp;utm_campaign=parser&amp;utm_content=thumbnail\" decoding=\"async\" loading=\"lazy\" width=\"64\" height=\"61\" class=\"mw-file-element\" srcset=\"https://thumb.wikimedia.org/wikipedia/commons/thumb/1/1b/Control_copyright_icon.svg/250px-Control_copyright_icon.svg.png?utm_source=commons.wikimedia.org&amp;utm_campaign=parser&amp;utm_content=thumbnail 2x\" data-file-width=\"171\" data-file-height=\"163\"></a></span>\n</td><td style=\"padding:4px;\"><div style=\"margin-top:0.5em;\">This image is <b>not in the <a href=\"https://en.wikipedia.org/wiki/Public_domain\" class=\"extiw\" title=\"en:Public domain\">public domain</a></b>. Please respect the copyright protection. It may only be used according to the rules mentioned here. This specifically <b>excludes use in social media</b>, if applicable terms of the licenses listed here are not appropriate.</div>\n</td></tr></tbody></table></div>\n<div style=\"clear:both; border:2px solid #00cc00; background-color:#f7f7f7; margin-top:6px;\">\n<table><tbody><tr><td style=\"padding:4px;\"><span typeof=\"mw:File\"><a href=\"//commons.wikimedia.org/wiki/File:Upload-problem2.svg\" class=\"mw-file-description\"><img src=\"https://thumb.wikimedia.org/wikipedia/commons/thumb/f/f9/Upload-problem2.svg/120px-Upload-problem2.svg.png?utm_source=commons.wikimedia.org&amp;utm_campaign=parser&amp;utm_content=thumbnail\" decoding=\"async\" loading=\"lazy\" width=\"64\" height=\"57\" class=\"mw-file-element\" srcset=\"https://thumb.wikimedia.org/wikipedia/commons/thumb/f/f9/Upload-problem2.svg/250px-Upload-problem2.svg.png?utm_source=commons.wikimedia.org&amp;utm_campaign=parser&amp;utm_content=thumbnail 2x\" data-file-width=\"159\" data-file-height=\"142\"></a></span>\n</td><td style=\"padding:4px;\"><div style=\"margin-top:0.5em;\">Please do not upload an updated image here without consultation with the Author. The author would like to make corrections only at his own source. This ensures that the changes are preserved.<br>Please if you think that any changes should be required, please inform the author.<br>Otherwise you can upload a new image with a new name. Please use one of the templates <a href=\"//commons.wikimedia.org/wiki/Template:Derived_from\" title=\"Template:Derived from\">derivative</a> or <a href=\"//commons.wikimedia.org/wiki/Template:Extracted_from\" title=\"Template:Extracted from\">extract</a>.</div>\n</td></tr></tbody></table></div>"
  },
  "AttributionRequired": {
    "value": "true"
  },
  "LicenseShortName": {
    "value": "CC BY-SA 3.0"
  },
  "LicenseUrl": {
    "value": "https://creativecommons.org/licenses/by-sa/3.0"
  }
};

/** Fearless Girl: `File:Fearless Girl at Paternoster Square in 3D 2.jpg`. */
export const FEARLESS_GIRL: ExtMetadata = {
  "Artist": {
    "value": "<table style=\"margin: 1.5em auto; width:100%; color:var(--color-base,#202122); background-color:var(--background-color-neutral-subtle,#f8f9fa); border:2px solid #cccccc; padding:1px;\" cellspacing=\"10\">\n\n\n<tbody><tr>\n<td align=\"center\"><span typeof=\"mw:File\"><a href=\"//commons.wikimedia.org/wiki/File:Fearless_Girl_at_Paternoster_Square_in_3D_2.jpg\" class=\"mw-file-description\"><img src=\"https://thumb.wikimedia.org/wikipedia/commons/thumb/9/93/Fearless_Girl_at_Paternoster_Square_in_3D_2.jpg/250px-Fearless_Girl_at_Paternoster_Square_in_3D_2.jpg?utm_source=commons.wikimedia.org&amp;utm_campaign=parser&amp;utm_content=thumbnail\" decoding=\"async\" loading=\"lazy\" width=\"160\" height=\"90\" class=\"mw-file-element\" srcset=\"https://thumb.wikimedia.org/wikipedia/commons/thumb/9/93/Fearless_Girl_at_Paternoster_Square_in_3D_2.jpg/330px-Fearless_Girl_at_Paternoster_Square_in_3D_2.jpg?utm_source=commons.wikimedia.org&amp;utm_campaign=parser&amp;utm_content=thumbnail 2x\" data-file-width=\"6354\" data-file-height=\"3574\"></a></span>\n</td>\n<td align=\"center\"><a href=\"https://upload.wikimedia.org/wikipedia/commons/9/93/Fearless_Girl_at_Paternoster_Square_in_3D_2.jpg?utm_source=commons.wikimedia.org&amp;utm_campaign=api&amp;utm_content=original\" class=\"internal\" title=\"Fearless Girl at Paternoster Square in 3D 2.jpg\"><b> This image</b></a> is a work by Wikipedia and Wikimedia Commons user C.Suthorn. When reusing, <a rel=\"nofollow\" class=\"external text\" href=\"https://p7press.eu/easy-attribution?file=Fearless_Girl_at_Paternoster_Square_in_3D_2.jpg&amp;ref=fearlessgrl&amp;author=C.Suthorn&amp;lic=cc-by-sa-4.0&amp;type=print,social\"><i>credit</i></a> me as described in the Licensing information below. <span typeof=\"mw:File\"><span><img src=\"https://thumb.wikimedia.org/wikipedia/commons/thumb/e/ea/UserIconMail.svg/40px-UserIconMail.svg.png?utm_source=commons.wikimedia.org&amp;utm_campaign=parser&amp;utm_content=thumbnail\" decoding=\"async\" loading=\"lazy\" width=\"24\" height=\"24\" class=\"mw-file-element\" srcset=\"https://thumb.wikimedia.org/wikipedia/commons/thumb/e/ea/UserIconMail.svg/60px-UserIconMail.svg.png?utm_source=commons.wikimedia.org&amp;utm_campaign=parser&amp;utm_content=thumbnail 2x\" data-file-width=\"700\" data-file-height=\"700\"></span></span> I would appreciate being notified (<a href=\"//commons.wikimedia.org/wiki/Special:EmailUser/C.Suthorn\" title=\"Special:EmailUser/C.Suthorn\">wikimail</a>, <a href=\"//commons.wikimedia.org/wiki/User_talk:C.Suthorn\" title=\"User talk:C.Suthorn\">talk page</a>, <a href=\"//commons.wikimedia.org/wiki/User:C.Suthorn\" title=\"User:C.Suthorn\">email</a>, <a rel=\"nofollow\" class=\"external text\" href=\"https://no-pony.farm/@Life_is\">Social Media</a>) if you use my work outside Wikimedia.\n<p>Do not copy this image illegally by ignoring the terms of the license below, as it is not in the public domain. If you would like special permission to use, license, or purchase the image please contact me to negotiate terms.\n</p><p><br>\n</p><p>More of my work can be found in my <a href=\"//commons.wikimedia.org/wiki/Category:Files_by_C.Suthorn\" title=\"Category:Files by C.Suthorn\">personal gallery</a> or at my <a rel=\"nofollow\" class=\"external text\" href=\"http://p7.ee/PRT/CHANNEL\">Peertube channel</a>.\n</p>\n</td></tr></tbody></table>\n<table style=\"margin: 1.5em auto; width:100%; color:var(--color-base,#202122); background-color:var(--background-color-success-subtle,#dff2eb); border:2px solid var(--border-color-success,#099979); padding:1px;\" cellspacing=\"10\">\n<tbody><tr>\n<td>A prepared attribution especially for use in Social Media and Print (newspapers, flyers, books, murals, mousepads, mugs, posters, t-shirts) can be copied <a rel=\"nofollow\" class=\"external text\" href=\"https://p7press.eu/easy-attribution?file=Fearless_Girl_at_Paternoster_Square_in_3D_2.jpg&amp;ref=fearlessgrl&amp;author=C.Suthorn&amp;lic=cc-by-sa-4.0&amp;type=print,social\"><i>here</i></a>\n</td></tr></tbody></table>\n<p><br>\n</p>"
  },
  "Attribution": {
    "value": "<a href=\"//commons.wikimedia.org/wiki/Creator:C.Suthorn\" title=\"Creator:C.Suthorn\">C.Suthorn</a> /  <span class=\"plainlinks\"><a rel=\"nofollow\" class=\"external text\" href=\"https://creativecommons.org/licenses/by-sa/4.0/legalcode\">cc-by-sa-4.0</a></span> / <a href=\"https://upload.wikimedia.org/wikipedia/commons/9/93/Fearless_Girl_at_Paternoster_Square_in_3D_2.jpg?utm_source=commons.wikimedia.org&amp;utm_campaign=api&amp;utm_content=original\" class=\"internal\" title=\"Fearless Girl at Paternoster Square in 3D 2.jpg\">commons.wikimedia.org</a><small><br>\n(Note the three necessary links to author, licence and image file in the attribution.)</small>"
  },
  "AttributionRequired": {
    "value": "true"
  },
  "LicenseShortName": {
    "value": "CC BY-SA 4.0"
  },
  "LicenseUrl": {
    "value": "https://creativecommons.org/licenses/by-sa/4.0"
  }
};
