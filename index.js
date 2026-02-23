import * as fs from 'fs'
import * as YAML from 'yaml'
import * as path from 'path'
import { globSync } from 'glob'

let aliasList = {}
let nameDictionary = {}
let imageDictionary = {}
const markdownFilePaths = globSync(`${process.cwd()}/input/**/*.md`)
const imageFilePaths = globSync(`${process.cwd()}/input/**/*.{jpg,png}`)
console.log(`Image Paths: ${JSON.stringify(imageFilePaths)}`)

// create dictionary for mapping documents
markdownFilePaths.forEach((filePath)=>{
  const relativePath = path.relative(`${process.cwd()}/input`, filePath)
  const fileName = path.basename(filePath, path.extname(filePath))
  nameDictionary[fileName] = relativePath
})

// create dictionary for mapping images
imageFilePaths.forEach((filePath)=>{
  const relativePath = path.relative(`${process.cwd()}/input`, filePath)
  const fileName = path.basename(filePath)
  imageDictionary[fileName] = `./${relativePath}`
})
console.log(`Image Dict: ${JSON.stringify(imageDictionary)}`)

// create dictionary for mapping document aliases
markdownFilePaths.forEach((filePath)=>{
  let fileContents = fs.readFileSync(filePath).toString()
  indexAliases(fileContents).forEach((alias)=>{
    aliasList[alias] = path.basename(filePath, path.extname(filePath))
  })
})

// replace image links 
markdownFilePaths.forEach((filePath)=>{
  let fileContents = fs.readFileSync(filePath).toString()
  replaceImageLinks(fileContents);
})

// replace aliased links


// replace other document links


function replaceImageLinks (input) {
  let workingFile = input.toString()
  const pattern = /\!\[\[(.*?)\]\]/gm
  const matches = [...workingFile.matchAll(pattern)]
  if (matches && matches[0]) {
    matches.forEach((match)=>{
      if(imageDictionary[match[1]]){
        workingFile = workingFile.replace(match[0],`![](${imageDictionary[match[1]]})`)
      }
    })
  }
  return workingFile
  // return input.replaceAll(pattern,`![]($1)`)
}

function replaceAliasedLinks (input) {
  const pattern = /\!\[\[(.*?)|()\]\]/gm
  return input.replaceAll(pattern,`![]($1)`)
}

function indexAliases (input) {
  let output = []
  let matches = /(?<=---$)[\s\S]*?(?=^---)/gm.exec(input)
  if (matches) { 
    matches.forEach((match) => {
      const text = match.trim()
      const properties = YAML.parse(text)
      if (properties["aliases"]) {
        properties["aliases"].forEach((alias)=>{
          output.push(alias)
        })
      }
    })
  }
  return output
}