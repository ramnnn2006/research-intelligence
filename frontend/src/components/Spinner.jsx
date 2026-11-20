import React from 'react'
const s = {
  display:'inline-block',width:14,height:14,border:'2px solid #E6E0D0',
  borderTopColor:'#1E4FA0',borderRadius:'50%',animation:'spin .6s linear infinite',
  verticalAlign:'middle',marginRight:6
}
const kf = `@keyframes spin{to{transform:rotate(360deg)}}`
export default function Spinner(){
  return <><style>{kf}</style><span style={s}/></>
}
