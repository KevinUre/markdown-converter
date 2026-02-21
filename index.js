import * as fs from 'fs'
import * as YAML from 'yaml'
import * as path from 'path'
import { globSync } from 'glob'

let aliasList = {}
let nameDictionary = {}
const markdownFilePaths = globSync(`${process.cwd()}/input/**/*.md`)
// console.log(JSON.stringify(markdownFilePaths))
markdownFilePaths.forEach((filePath)=>{
  const relativePath = path.relative(`${process.cwd()}/input`, filePath)
  const fileName = path.basename(filePath, path.extname(filePath))
  nameDictionary[fileName] = relativePath
})
markdownFilePaths.forEach((filePath)=>{
  let fileContents = fs.readFileSync(filePath).toString()
  indexAliases(fileContents).forEach((alias)=>{
    aliasList[alias] = path.basename(filePath, path.extname(filePath))
  })
})
console.log(JSON.stringify(nameDictionary))
console.log(JSON.stringify(aliasList))

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